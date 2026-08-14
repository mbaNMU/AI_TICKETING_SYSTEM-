import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db, verifyPassword } from './server/db.js';
import { classifyTicket, getSupportAssistantChatResponse } from './server/aiService.js';
import { sendTicketConfirmationEmail, sendTicketStatusUpdateEmail } from './server/emailService.js';
import { RequestItem, Priority, RequestStatus } from './src/types/index.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Helper middleware to extract user header or simple token
  const getUserFromReq = (req: express.Request) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const userId = authHeader.replace('Bearer ', '');
      return db.findUserById(userId);
    }
    return null;
  };

  // --- API ROUTES ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Auth: Register
  app.post('/api/auth/register', (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
      }

      const existing = db.findUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }

      // Only allow CUSTOMER or EMPLOYEE self-registration. ADMIN role is reserved for global admin assignment.
      const assignedRole = ['CUSTOMER', 'EMPLOYEE'].includes(role) ? role : 'CUSTOMER';
      const newUser = db.createUser({
        name,
        email,
        password,
        role: assignedRole,
      });

      db.addAuditLog(newUser.id, newUser.email, 'USER_REGISTERED', 'USER', newUser.id, `User registered with role ${assignedRole}`);

      return res.json({ user: newUser, token: newUser.id });
    } catch (err: any) {
      console.error('Register error:', err);
      return res.status(500).json({ error: err.message || 'Registration failed' });
    }
  });

  // Auth: Login
  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = db.findUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const { passwordHash, ...cleanUser } = user;
      db.addAuditLog(cleanUser.id, cleanUser.email, 'USER_LOGIN', 'USER', cleanUser.id, 'User logged in successfully');

      return res.json({ user: cleanUser, token: cleanUser.id });
    } catch (err: any) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  // Auth: Logout
  app.post('/api/auth/logout', (req, res) => {
    const currentUser = getUserFromReq(req);
    if (currentUser) {
      db.addAuditLog(currentUser.id, currentUser.email, 'USER_LOGOUT', 'USER', currentUser.id, 'User logged out');
    }
    return res.json({ message: 'Logged out successfully' });
  });

  // Auth: Me
  app.get('/api/auth/me', (req, res) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.json({ user });
  });

  // AI Support Assistant Chat endpoint
  app.post('/api/ai/support-assistant', async (req, res) => {
    try {
      const { userMessage, chatHistory, statusFlag } = req.body;
      if (!userMessage && !statusFlag) {
        return res.status(400).json({ error: 'userMessage or statusFlag is required' });
      }

      const response = await getSupportAssistantChatResponse(
        userMessage || 'Please help me create a ticket',
        chatHistory || [],
        statusFlag
      );

      return res.json(response);
    } catch (err: any) {
      console.error('Support assistant API error:', err);
      return res.status(500).json({ error: err.message || 'AI Assistant failed to generate response' });
    }
  });

  // Categories API
  app.get('/api/categories', (req, res) => {
    return res.json({ categories: db.getCategories() });
  });

  app.post('/api/categories', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const cat = db.createCategory(name, description || '');
    db.addAuditLog(user.id, user.email, 'CREATE_CATEGORY', 'CATEGORY', cat.id, `Created new category ${name}`);
    return res.json({ category: cat });
  });

  // Requests API: Get Requests
  app.get('/api/requests', (req, res) => {
    const user = getUserFromReq(req);
    let requests = db.getRequests();

    // If customer or employee, non-admin users only see their own requests unless admin
    if (user && user.role !== 'ADMIN') {
      requests = requests.filter((r) => r.userId === user.id);
    }

    const { category, priority, status, department, search } = req.query;

    if (category && typeof category === 'string') {
      requests = requests.filter((r) => r.aiClassification?.category === category);
    }
    if (priority && typeof priority === 'string') {
      requests = requests.filter((r) => r.priority === priority);
    }
    if (status && typeof status === 'string') {
      requests = requests.filter((r) => r.status === status);
    }
    if (department && typeof department === 'string') {
      requests = requests.filter((r) => r.department === department);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      requests = requests.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          (r.userName && r.userName.toLowerCase().includes(q))
      );
    }

    return res.json({ requests });
  });

  // Requests API: Submit Request
  app.post('/api/requests', async (req, res) => {
    try {
      const user = getUserFromReq(req);
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { title, description, requestType, priority, department, attachments } = req.body;

      if (!title || !description || !requestType || !priority) {
        return res.status(400).json({ error: 'Title, description, requestType, and priority are required' });
      }

      // Create Request
      const newReq = db.createRequest({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        title,
        description,
        requestType,
        priority: priority as Priority,
        department,
        attachments: attachments || [],
      });

      db.addAuditLog(user.id, user.email, 'CREATE_REQUEST', 'REQUEST', newReq.id, `Submitted request ${newReq.id}`);

      // Perform AI Ticket Classification asynchronously/inline
      try {
        await classifyTicket(newReq);
      } catch (aiErr) {
        console.error('AI classification failed on creation:', aiErr);
      }

      // Fetch fresh updated request with AI metadata
      const freshReq = db.getRequestById(newReq.id) || newReq;

      // Send confirmation email
      sendTicketConfirmationEmail(freshReq);

      return res.status(201).json({ request: freshReq });
    } catch (err: any) {
      console.error('Create request error:', err);
      return res.status(500).json({ error: 'Failed to create request' });
    }
  });

  // Requests API: Get Single Request
  app.get('/api/requests/:id', (req, res) => {
    const user = getUserFromReq(req);
    const reqItem = db.getRequestById(req.params.id);

    if (!reqItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (user && user.role !== 'ADMIN' && reqItem.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({ request: reqItem });
  });

  // Requests API: Update Request Status / Priority / Notes
  app.patch('/api/requests/:id', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }

    const reqItem = db.getRequestById(req.params.id);
    if (!reqItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const oldStatus = reqItem.status;
    const { status, priority, department, assignedToUserId, assignedToName, resolutionNotes, internalNote } = req.body;

    const updates: Partial<RequestItem> = {};
    if (status) updates.status = status as RequestStatus;
    if (priority) updates.priority = priority as Priority;
    if (department) updates.department = department;
    if (assignedToUserId) updates.assignedToUserId = assignedToUserId;
    if (assignedToName) updates.assignedToName = assignedToName;
    if (resolutionNotes !== undefined) updates.resolutionNotes = resolutionNotes;

    if (internalNote) {
      updates.internalNotes = [...(reqItem.internalNotes || []), `[${new Date().toLocaleString()}] ${user.name}: ${internalNote}`];
    }

    const updated = db.updateRequest(reqItem.id, updates);

    db.addAuditLog(user.id, user.email, 'UPDATE_REQUEST', 'REQUEST', reqItem.id, `Updated request ${reqItem.id}. Status: ${oldStatus} -> ${updated?.status}`);

    if (updated && ((status && status !== oldStatus) || (resolutionNotes !== undefined && resolutionNotes !== reqItem.resolutionNotes))) {
      sendTicketStatusUpdateEmail(updated, oldStatus, updated.status);
    }

    return res.json({ request: updated });
  });

  // Requests API: Retry / Trigger AI Classification
  app.post('/api/requests/:id/classify', async (req, res) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const reqItem = db.getRequestById(req.params.id);
    if (!reqItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    try {
      const classification = await classifyTicket(reqItem);
      const updatedReq = db.getRequestById(reqItem.id);
      db.addAuditLog(user.id, user.email, 'CLASSIFY_REQUEST', 'REQUEST', reqItem.id, `Triggered AI classification for ${reqItem.id}`);
      return res.json({ request: updatedReq, classification });
    } catch (err: any) {
      return res.status(500).json({ error: 'AI classification failed' });
    }
  });

  // Requests API: Admin Manual AI Override
  app.post('/api/requests/:id/override-ai', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }

    const { category, priority, notes } = req.body;
    if (!category) {
      return res.status(400).json({ error: 'Category is required for override' });
    }

    const updatedReq = db.overrideAIClassification(req.params.id, category, priority || 'Medium', user.name, notes || '');
    if (!updatedReq) {
      return res.status(404).json({ error: 'Request not found' });
    }

    db.addAuditLog(user.id, user.email, 'OVERRIDE_AI_CLASSIFICATION', 'REQUEST', req.params.id, `Admin overridden AI category to ${category}`);
    return res.json({ request: updatedReq });
  });

  // Dashboard Statistics API
  app.get('/api/dashboard', (req, res) => {
    const user = getUserFromReq(req);
    let requests = db.getRequests();

    if (user && user.role !== 'ADMIN') {
      requests = requests.filter((r) => r.userId === user.id);
    }

    const totalRequests = requests.length;
    const openRequests = requests.filter((r) => r.status === 'Submitted' || r.status === 'AI Classified' || r.status === 'Under Review').length;
    const inProgressRequests = requests.filter((r) => r.status === 'In Progress').length;
    const resolvedRequests = requests.filter((r) => r.status === 'Resolved' || r.status === 'Closed').length;
    const aiClassifiedRequests = requests.filter((r) => r.aiClassification && !r.aiClassification.isOverridden).length;

    // Category breakdown
    const catCounts: Record<string, number> = {};
    const prioCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    const deptCounts: Record<string, number> = {};

    requests.forEach((r) => {
      const cat = r.aiClassification?.category || 'Unclassified';
      catCounts[cat] = (catCounts[cat] || 0) + 1;

      prioCounts[r.priority] = (prioCounts[r.priority] || 0) + 1;
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

      const dept = r.department || 'General';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });

    const categoryBreakdown = Object.entries(catCounts).map(([category, count]) => ({ category, count }));
    const priorityBreakdown = Object.entries(prioCounts).map(([priority, count]) => ({ priority, count }));
    const statusBreakdown = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
    const departmentBreakdown = Object.entries(deptCounts).map(([department, count]) => ({ department, count }));

    return res.json({
      stats: {
        totalRequests,
        openRequests,
        inProgressRequests,
        resolvedRequests,
        aiClassifiedRequests,
        avgResolutionHours: 2.4,
        categoryBreakdown,
        priorityBreakdown,
        statusBreakdown,
        departmentBreakdown,
      },
    });
  });

  // Admin: List Users & Role Management
  app.get('/api/admin/users', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }
    return res.json({ users: db.getUsers() });
  });

  app.patch('/api/admin/users/:id/role', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }

    const { role } = req.body;
    if (!['CUSTOMER', 'EMPLOYEE', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const updatedUser = db.updateUserRole(req.params.id, role);
    db.addAuditLog(user.id, user.email, 'UPDATE_USER_ROLE', 'USER', req.params.id, `Changed role to ${role}`);
    return res.json({ user: updatedUser });
  });

  // Admin: Audit Logs
  app.get('/api/admin/audit-logs', (req, res) => {
    const user = getUserFromReq(req);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin authorization required' });
    }
    return res.json({ logs: db.getAuditLogs() });
  });

  // Email Notifications / Inbox Logs
  app.get('/api/email-logs', (req, res) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (user.role === 'ADMIN') {
      return res.json({ emails: db.getEmailNotifications() });
    } else {
      return res.json({ emails: db.getEmailNotifications(user.email) });
    }
  });

  app.patch('/api/email-logs/:id/read', (req, res) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const email = db.markEmailAsRead(req.params.id);
    return res.json({ email });
  });

  app.post('/api/email-logs/read-all', (req, res) => {
    const user = getUserFromReq(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (user.role === 'ADMIN') {
      db.markAllEmailsAsRead();
    } else {
      db.markAllEmailsAsRead(user.email);
    }
    return res.json({ success: true });
  });

  // --- VITE MIDDLEWARE FOR DEVELOPMENT & STATIC SERVING FOR PRODUCTION ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OpsAI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
