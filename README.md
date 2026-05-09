# LeadCRM 🚀

A full-stack CRM for managing client leads captured from website contact forms.

## Stack
- **Frontend**: HTML · CSS · Vanilla JS (SPA)
- **Backend**: Node.js · Express
- **Database**: MySQL 8+

## Quick Start

### 1. Prerequisites
- Node.js ≥ 18
- MySQL 8 running locally (or remote)

### 2. Install dependencies
```bash
cd crm
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# edit .env with your MySQL credentials
```

### 4. Initialize database & seed data
```bash
npm run setup
```
This creates the `crm_db` database, all tables, a default admin account, and 3 sample leads.

### 5. Start the server
```bash
npm start          # production
npm run dev        # hot-reload with nodemon
```

Open **http://localhost:3000** in your browser.

## Default Login
| Field    | Value      |
|----------|------------|
| Username | `admin`    |
| Password | `Admin@1234` |

> Change the password after first login via direct DB update or add a "change password" route.

## API Reference

### Public (no auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/public/leads` | Submit a lead from a contact form |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET  | `/api/auth/me` | Check session |

### Leads (auth required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/leads` | List leads (filter: status, search) |
| GET    | `/api/leads/:id` | Get lead + notes |
| POST   | `/api/leads` | Create lead |
| PUT    | `/api/leads/:id` | Update lead |
| PATCH  | `/api/leads/:id/status` | Quick status update |
| DELETE | `/api/leads/:id` | Delete lead |

### Notes (auth required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/api/leads/:id/notes` | Add note |
| DELETE | `/api/notes/:id` | Delete note |

### Stats (auth required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Dashboard stats |

## Embedding the Contact Form

Add this to any website to auto-submit leads:

```html
<form id="contact-form">
  <input name="name"    placeholder="Your Name"    required />
  <input name="email"   placeholder="Email"        required type="email" />
  <input name="phone"   placeholder="Phone" />
  <input name="company" placeholder="Company" />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
<script>
document.getElementById('contact-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.source = 'Website';
  await fetch('http://YOUR_SERVER/api/public/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  alert('Thanks! We will be in touch.');
});
</script>
```

## Project Structure
```
crm/
├── server.js          # Express app + all API routes
├── setup-db.js        # One-time DB init script
├── package.json
├── .env.example
└── public/
    ├── index.html     # SPA shell
    ├── css/
    │   └── style.css  # Full design system
    └── js/
        └── app.js     # Frontend logic
```

## Security Features
- Session-based auth with HttpOnly cookies
- bcrypt password hashing (12 rounds)
- Rate limiting on login endpoint (10 req / 15 min)
- SQL injection prevention via parameterized queries
- XSS prevention via server-side escaping + CSP-friendly frontend
