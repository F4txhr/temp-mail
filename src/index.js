/**
 * Temporary Email Service using Cloudflare Workers
 * Features:
 * - Generate random temp email addresses
 * - Receive emails via webhook
 * - Store emails in KV
 * - Retrieve inbox
 * - Auto-expire mailboxes
 */

const DOMAIN = "tempmail.example.com"; // Change this to your domain
const MAILBOX_TTL = 3600 * 24; // 24 hours in seconds
const EMAIL_TTL = 3600 * 24; // 24 hours

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Create new temporary email
      if (path === "/api/create" && request.method === "POST") {
        const mailboxId = generateRandomString(10);
        const email = `${mailboxId}@${DOMAIN}`;
        
        const mailboxData = {
          id: mailboxId,
          email: email,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + MAILBOX_TTL * 1000).toISOString(),
        };

        await env.MAILBOXES.put(
          mailboxId,
          JSON.stringify(mailboxData),
          { expirationTtl: MAILBOX_TTL }
        );

        return new Response(JSON.stringify(mailboxData), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Receive email webhook (from MailChannels, Mailgun, etc.)
      if (path === "/api/incoming" && request.method === "POST") {
        const emailData = await request.json();
        const to = emailData.to || "";
        const mailboxId = to.split("@")[0];

        if (!mailboxId) {
          return new Response(JSON.stringify({ error: "Invalid recipient" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Verify mailbox exists
        const mailbox = await env.MAILBOXES.get(mailboxId);
        if (!mailbox) {
          return new Response(JSON.stringify({ error: "Mailbox not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Store email
        const emailId = `${Date.now()}-${generateRandomString(8)}`;
        const storedEmail = {
          id: emailId,
          from: emailData.from || "unknown",
          to: emailData.to || "",
          subject: emailData.subject || "(No Subject)",
          text: emailData.text || "",
          html: emailData.html || "",
          receivedAt: new Date().toISOString(),
        };

        const key = `${mailboxId}/${emailId}`;
        await env.EMAILS.put(
          key,
          JSON.stringify(storedEmail),
          { expirationTtl: EMAIL_TTL }
        );

        return new Response(JSON.stringify({ status: "received", emailId }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get mailbox inbox
      if (path.startsWith("/api/inbox/") && request.method === "GET") {
        const mailboxId = path.split("/")[3];

        // Check if mailbox exists
        const mailbox = await env.MAILBOXES.get(mailboxId);
        if (!mailbox) {
          return new Response(JSON.stringify({ error: "Mailbox not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get all emails for this mailbox
        const list = await env.EMAILS.list({ prefix: `${mailboxId}/` });
        const emails = [];

        for (const key of list.keys) {
          const emailJson = await env.EMAILS.get(key.name);
          if (emailJson) {
            emails.push(JSON.parse(emailJson));
          }
        }

        // Sort by received time (newest first)
        emails.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

        return new Response(
          JSON.stringify({
            mailboxId,
            email: `${mailboxId}@${DOMAIN}`,
            emailCount: emails.length,
            emails,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get single email
      if (path.startsWith("/api/email/") && request.method === "GET") {
        const parts = path.split("/");
        const mailboxId = parts[3];
        const emailId = parts[4];

        const emailJson = await env.EMAILS.get(`${mailboxId}/${emailId}`);
        if (!emailJson) {
          return new Response(JSON.stringify({ error: "Email not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify(JSON.parse(emailJson)), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete email
      if (path.startsWith("/api/email/") && request.method === "DELETE") {
        const parts = path.split("/");
        const mailboxId = parts[3];
        const emailId = parts[4];

        await env.EMAILS.delete(`${mailboxId}/${emailId}`);

        return new Response(JSON.stringify({ status: "deleted" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Serve simple web UI
      if (path === "/" || path === "/index.html") {
        return new Response(getHtmlUI(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },

  // Scheduled handler for cleanup (runs hourly)
  async scheduled(event, env, ctx) {
    console.log("Running cleanup task...");
    
    const now = new Date();
    const mailboxesList = await env.MAILBOXES.list();

    for (const mailbox of mailboxesList.keys) {
      const data = await env.MAILBOXES.get(mailbox.name);
      if (data) {
        const parsed = JSON.parse(data);
        if (new Date(parsed.expiresAt) < now) {
          await env.MAILBOXES.delete(mailbox.name);
          // Also delete all emails in this mailbox
          const emailsList = await env.EMAILS.list({ prefix: `${mailbox.name}/` });
          for (const email of emailsList.keys) {
            await env.EMAILS.delete(email.name);
          }
          console.log(`Deleted expired mailbox: ${mailbox.name}`);
        }
      }
    }
  },
};

// Utility function to generate random string
function generateRandomString(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Simple HTML UI
function getHtmlUI() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Temp Mail - Temporary Email Service</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }

    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }

    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
      width: 100%;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
    }

    button:active {
      transform: translateY(0);
    }

    .email-display {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 20px;
      margin-top: 20px;
      display: none;
    }

    .email-display.show {
      display: block;
    }

    .email-address {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      word-break: break-all;
    }

    .copy-btn {
      background: #e9ecef;
      color: #495057;
      padding: 8px 16px;
      margin-top: 10px;
      font-size: 14px;
    }

    .copy-btn:hover {
      background: #dee2e6;
    }

    .inbox {
      margin-top: 20px;
      max-height: 400px;
      overflow-y: auto;
    }

    .email-item {
      background: white;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .email-item:hover {
      background: #f8f9fa;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .email-from {
      font-weight: 600;
      color: #333;
      font-size: 14px;
    }

    .email-subject {
      color: #666;
      font-size: 13px;
      margin-top: 4px;
    }

    .email-time {
      color: #adb5bd;
      font-size: 12px;
      margin-top: 4px;
    }

    .loading {
      text-align: center;
      color: #666;
      padding: 20px;
    }

    .error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
      padding: 12px;
      border-radius: 6px;
      margin-top: 10px;
      display: none;
    }

    .error.show {
      display: block;
    }

    .success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
      padding: 12px;
      border-radius: 6px;
      margin-top: 10px;
      display: none;
    }

    .success.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📧 Temp Mail</h1>
    <p class="subtitle">Create a temporary email address instantly</p>

    <div class="form-group">
      <button onclick="createMailbox()">Generate New Email Address</button>
    </div>

    <div class="error" id="error"></div>
    <div class="success" id="success"></div>

    <div class="email-display" id="emailDisplay">
      <p class="email-address" id="emailAddress">Loading...</p>
      <button class="copy-btn" onclick="copyEmail()">📋 Copy Email</button>
      
      <div class="loading" id="loading">Loading inbox...</div>
      <div class="inbox" id="inbox"></div>
    </div>
  </div>

  <script>
    let currentMailboxId = null;
    let refreshInterval = null;

    function showError(message) {
      const el = document.getElementById('error');
      el.textContent = message;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 5000);
    }

    function showSuccess(message) {
      const el = document.getElementById('success');
      el.textContent = message;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3000);
    }

    async function createMailbox() {
      try {
        const response = await fetch('/api/create', { method: 'POST' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create mailbox');
        }

        currentMailboxId = data.id;
        document.getElementById('emailAddress').textContent = data.email;
        document.getElementById('emailDisplay').classList.add('show');
        
        showSuccess('Email created successfully!');
        loadInbox();

        // Refresh inbox every 5 seconds
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(loadInbox, 5000);
      } catch (error) {
        showError('Error: ' + error.message);
      }
    }

    async function loadInbox() {
      if (!currentMailboxId) return;

      try {
        const response = await fetch(\`/api/inbox/\${currentMailboxId}\`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load inbox');
        }

        const inbox = document.getElementById('inbox');
        document.getElementById('loading').style.display = 'none';

        if (data.emails.length === 0) {
          inbox.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No emails yet</p>';
          return;
        }

        inbox.innerHTML = data.emails.map(email => \`
          <div class="email-item">
            <div class="email-from">From: \${escapeHtml(email.from)}</div>
            <div class="email-subject">Subject: \${escapeHtml(email.subject)}</div>
            <div class="email-time">\${new Date(email.receivedAt).toLocaleString()}</div>
          </div>
        \`).join('');
      } catch (error) {
        console.error('Error loading inbox:', error);
      }
    }

    function copyEmail() {
      const email = document.getElementById('emailAddress').textContent;
      navigator.clipboard.writeText(email).then(() => {
        showSuccess('Email copied to clipboard!');
      });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>
  `;
}
  `;
