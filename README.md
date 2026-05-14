# Temp Mail - Temporary Email Service with Cloudflare Workers

A fast, simple temporary email service built on **Cloudflare Workers** and **Cloudflare KV**.

## 🚀 Features

- ✅ Generate random temporary email addresses
- ✅ Receive emails via webhook
- ✅ Simple web UI to view inbox
- ✅ REST API for programmatic access
- ✅ Auto-cleanup after 24 hours
- ✅ No database required (uses Cloudflare KV)
- ✅ Deployed globally on the edge

## 📋 Prerequisites

- Cloudflare account (free tier works)
- Node.js & npm
- Wrangler CLI: `npm install -g @cloudflare/wrangler`

## 🔧 Setup

### 1. Clone Repository
```bash
git clone https://github.com/F4txhr/temp-mail.git
cd temp-mail
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Authenticate with Cloudflare
```bash
wrangler login
```

### 4. Create KV Namespaces
```bash
wrangler kv:namespace create "EMAILS"
wrangler kv:namespace create "MAILBOXES"
```

Copy the output namespace IDs and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "EMAILS"
id = "your-emails-id-here"

[[kv_namespaces]]
binding = "MAILBOXES"
id = "your-mailboxes-id-here"
```

### 5. Deploy
```bash
wrangler publish
```

Your worker will be deployed at: `https://temp-mail-<account>.workers.dev`

## 📡 API Endpoints

### 1. Create New Email
```
POST /api/create
```
**Response:**
```json
{
  "mailboxId": "abc123def456",
  "email": "abc123def456@tempmail.dev",
  "expiresIn": "24 hours"
}
```

### 2. Receive Email (Webhook)
```
POST /api/incoming
Content-Type: application/json

{
  "from": "sender@example.com",
  "to": "abc123def456@tempmail.dev",
  "subject": "Hello",
  "text": "Email body",
  "html": "<p>Email body</p>"
}
```

### 3. Get Inbox
```
GET /api/inbox/{mailboxId}
```
**Response:**
```json
{
  "mailboxId": "abc123def456",
  "email": "abc123def456@tempmail.dev",
  "emails": [
    {
      "id": "xyz789",
      "from": "sender@example.com",
      "subject": "Hello",
      "text": "Email body",
      "received": 1715702400000
    }
  ]
}
```

### 4. Get Single Email
```
GET /api/email/{mailboxId}/{emailId}
```

### 5. Delete Email
```
DELETE /api/email/{mailboxId}/{emailId}
```

### 6. Delete Mailbox
```
DELETE /api/mailbox/{mailboxId}
```

## 🔌 Email Integration

To receive actual emails, you need to integrate with an email service:

### Option 1: Mailgun (Recommended)
1. Sign up at [mailgun.com](https://www.mailgun.com/)
2. Get a sandbox domain
3. Configure routing to POST to: `https://your-worker.workers.dev/api/incoming`
4. Update your Worker custom domain in `wrangler.toml`

### Option 2: MailChannels
```toml
[env.production]
routes = [
  { pattern = "mail.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

### Option 3: Forward Email
Use Forward Email's webhook feature to send emails to your Worker endpoint.

## 📝 Usage Example

```bash
# Create a temp email
curl -X POST https://temp-mail.workers.dev/api/create

# Response:
# {
#   "mailboxId": "abc123",
#   "email": "abc123@tempmail.dev"
# }

# Check inbox
curl https://temp-mail.workers.dev/api/inbox/abc123

# Send a test email to your temp address
# (using your email service webhook)

# View emails in inbox
curl https://temp-mail.workers.dev/api/inbox/abc123
```

## 🛡️ Security & Rate Limiting

Currently, the service has:
- ✅ CORS enabled for all origins
- ✅ 24-hour auto-expiry for mailboxes
- ⚠️ No rate limiting (add for production!)
- ⚠️ No authentication (add before public use!)

### Add Rate Limiting (Example)
```javascript
// In src/index.js, add at the top:
const RATE_LIMIT = 10; // requests per minute
const rateLimitStore = new Map();

// Check rate limit:
const ip = request.headers.get('cf-connecting-ip');
const count = rateLimitStore.get(ip) || 0;
if (count > RATE_LIMIT) {
  return new Response('Rate limit exceeded', { status: 429 });
}
```

## 🧹 Cleanup

Expired mailboxes and emails are automatically deleted via scheduled tasks (runs hourly).

## 📚 Development

### Run Locally
```bash
wrangler dev
```

Open `http://localhost:8787` to test locally.

### Debug
```bash
wrangler tail
```

## 🚀 Production Checklist

- [ ] Add authentication/API keys
- [ ] Set up rate limiting
- [ ] Configure CORS properly (restrict origins)
- [ ] Add spam filtering
- [ ] Set up custom domain
- [ ] Monitor KV usage
- [ ] Add logging/analytics
- [ ] Configure email service (Mailgun, etc.)

## 📄 License

MIT

## 🤝 Contributing

Feel free to open issues or submit PRs!

## 📞 Support

For help, check:
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare KV Docs](https://developers.cloudflare.com/workers/runtime-apis/kv/)

---

**Made with ❤️ using Cloudflare Workers**
