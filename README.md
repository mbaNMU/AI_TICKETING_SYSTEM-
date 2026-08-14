# OpsAI — AI Business Request Classification Platform

OpsAI is an AI-powered Business Operations Platform designed to help organizations receive, manage, and automatically classify business requests submitted by employees and customers.

Using server-side AI model integration (Gemini 3.6 Flash / OpenAI API), OpsAI automatically analyzes incoming requests and maps them into predefined business categories, generates concise summaries, recommends operational action steps, and sends automated email receipts with detailed tracking numbers.

---

## 🌟 Key Application Features

1. **Secure Authentication & Role-Based Access Control (RBAC)**:
   - Supports `CUSTOMER`, `EMPLOYEE`, and `ADMIN` user roles.
   - Secure password hashing (`pbkdf2Sync`) and protected API endpoints.
   - User session management and role auditing.

2. **Structured Business Request Submission**:
   - Allows users to submit requests with Title, Description, Type, Priority, Department, and optional File Attachments.
   - Instant ticket generation with unique tracking references (e.g., `REQ-2026-0812-4921`).

3. **Neural AI Ticket Classification Engine**:
   - Server-side integration with Gemini AI (`gemini-3.6-flash`) using structured JSON schema.
   - Automatically assigns Category, Subcategory, Executive Summary, Recommended Ops Action, Priority, and Confidence Score.
   - Graceful rule-based fallback if AI API keys are unavailable.

4. **Predefined Request Taxonomy**:
   - Standard business categories: *IT Support, Human Resources, Finance, Customer Support, Sales, Operations, Procurement, Technical Issue, Account Access, Billing, Product Inquiry, Complaint, General Inquiry, Other*.

5. **Human Review & Manual AI Classification Override**:
   - Operations administrators can review AI assignments, adjust categories, change priority levels, assign staff, and log audit override reasons.

6. **Automated Email Notifications**:
   - Generates ticket confirmation emails with Ticket Numbers and status update receipts.
   - Built-in Email Inbox Receipts Drawer to inspect delivered HTML emails.

7. **Operations Dashboard & Analytics**:
   - Real-time KPIs: Total Requests, Open Requests, In Progress, Resolved, AI Classified count.
   - Category breakdown charts, priority distributions, and average resolution speed.

8. **System Activity Audit Trail**:
   - Full audit trail logging user registrations, ticket creations, AI classification events, manual overrides, and staff role changes.

---

## 🏗️ Architecture

```text
User / Client Browser
        │
        ▼
Frontend SPA (React + Tailwind CSS)
        │
        ▼  [REST API / Bearer Tokens]
Backend Server (Express.js + Node.js)
        │
        ├───► Relational JSON Database (data/opsai.json)
        │
        └───► AI Classification Engine (Gemini 3.6 Flash / OpenAI API)
```

---

## 🛠️ Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide React Icons
- **Backend**: Node.js, Express.js, TypeScript, `tsx`, `esbuild`
- **AI Integration**: `@google/genai` SDK (`gemini-3.6-flash` model), Server-side API key handling
- **Storage**: Persistent JSON database store (`server/db.ts`)
- **Security**: Node.js Crypto PBKDF2 Password Hashing, Bearer Tokens, Role Authorization Middleware

---

## 🚀 Quick Start & Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/opsai-business-operations-platform.git
cd opsai-business-operations-platform
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Set your API keys inside `.env`:

```env
# Gemini API Key (Default)
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Optional OpenAI API Key
OPENAI_API_KEY="YOUR_OPENAI_API_KEY"

# Application Auth Secret
AUTH_SECRET="opsai_super_secret_jwt_key_2026"
```

### 4. Run Development Server

```bash
npm run dev
```

The app will start at `http://localhost:3000`.

### 5. Build for Production

```bash
npm run build
npm start
```

---

## 🔑 Demo Account Credentials

OpsAI comes pre-seeded with 3 instant demo accounts:

| Role | Email | Password | Scope |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@opsai.com` | `admin123` | Full access: ticket queue, AI overrides, user role management, system audit logs |
| **Employee** | `employee@company.com` | `employee123` | Submit requests, view employee requests, view AI categories |
| **Customer** | `customer@client.com` | `customer123` | Submit support/billing requests, track personal tickets & email notifications |

---

## 🛡️ Responsible AI Notice

*AI-generated classifications are intended to assist business operations and may require human review. Users should verify important classifications and decisions before taking action.*

---

## 📄 License

Apache-2.0 License.
