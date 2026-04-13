const nodemailer = require('nodemailer');

async function sendStatusUpdate(toEmail, clientName, requestId, newStatus, adminNotes) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return; // skip if not configured

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const statusLabel = newStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@vividviews.co',
    to: toEmail,
    subject: `Request #${requestId} Update — ${statusLabel}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #050d1a; color: #f0f6ff; padding: 40px; border-radius: 12px;">
        <h1 style="color: #00d4ff; margin-bottom: 8px;">Vivid Views</h1>
        <p style="color: #64748b; margin-bottom: 32px;">Client Portal Update</p>
        <h2 style="color: #f0f6ff;">Your request has been updated</h2>
        <p>Hi ${clientName},</p>
        <p>Request <strong>#${requestId}</strong> status has been updated to: <strong style="color: #00d4ff;">${statusLabel}</strong></p>
        ${adminNotes ? `<p><strong>Note from Vivid Views:</strong> ${adminNotes}</p>` : ''}
        <a href="${process.env.APP_URL || 'https://vividviews-portal-production.up.railway.app'}/portal/requests/${requestId}"
           style="display: inline-block; margin-top: 24px; padding: 12px 24px; background: linear-gradient(135deg, #00d4ff, #7c3aed); color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
          View Request
        </a>
      </div>
    `
  });
}

module.exports = { sendStatusUpdate };
