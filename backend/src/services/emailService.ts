import nodemailer from 'nodemailer';
import { queryOne } from '../db/connection';

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class EmailService {
  private static async getTransporter(): Promise<{ transporter: ReturnType<typeof nodemailer.createTransport> | null; fromAddress: string; appName: string }> {
    const hostRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_host']);
    const portRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_port']);
    const userRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_user']);
    const passRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_pass']);
    const fromRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_from']);
    const secureRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_secure']);
    const selfSignedRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['smtp_allow_self_signed']);
    const appNameRow = await queryOne<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', ['app_name']);

    const appName = appNameRow?.value || 'DecaTone';
    const host = hostRow?.value?.trim();
    if (!host) {
      return { transporter: null, fromAddress: '', appName };
    }

    const port = parseInt(portRow?.value || '587', 10);
    const secure = secureRow?.value === 'true' || port === 465;
    const user = userRow?.value?.trim();
    const pass = passRow?.value?.trim();
    const allowSelfSigned = selfSignedRow?.value || process.env.SMTP_ALLOW_SELF_SIGNED || 'false';
    const cleanAppName = appName.replace(/[\r\n<>"]/g, '');
    const fromAddress = fromRow?.value?.trim() || `${cleanAppName} Switchboard <noreply@${host}>`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized: allowSelfSigned !== 'true'
      }
    });

    return { transporter, fromAddress, appName };
  }

  private static wrapEmailHtml(appName: string, title: string, bodyHtml: string, ctaUrl?: string, ctaText?: string): string {
    const safeAppName = escapeHtml(appName);
    const safeTitle = escapeHtml(title);
    const safeCtaUrl = ctaUrl && /^https?:\/\//i.test(ctaUrl) ? escapeHtml(ctaUrl) : '';
    const safeCtaText = ctaText ? escapeHtml(ctaText) : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f17; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6; }
    .wrapper { width: 100%; max-width: 580px; margin: 24px auto; background-color: #121826; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { background: linear-gradient(135deg, rgba(14,165,233,0.15) 0%, rgba(245,158,11,0.1) 100%); padding: 28px 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .header h1 { margin: 0; font-size: 22px; color: #38bdf8; font-weight: 700; letter-spacing: 0.5px; }
    .content { padding: 28px 24px; font-size: 15px; line-height: 1.6; color: #e2e8f0; }
    .highlight-box { background: rgba(0,0,0,0.35); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
    .ext-number { font-family: monospace; font-size: 26px; font-weight: bold; color: #fbbf24; letter-spacing: 2px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 8px; margin-top: 18px; box-shadow: 0 4px 12px rgba(14,165,233,0.3); }
    .footer { padding: 18px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid rgba(255,255,255,0.06); }
    .footer a { color: #0ea5e9; text-decoration: none; }
  </style>
</head>
<body>
  <div style="padding: 16px;">
    <div class="wrapper">
      <div class="header">
        <h1>☎️ ${safeAppName}</h1>
      </div>
      <div class="content">
        <h2 style="margin-top: 0; font-size: 18px; color: #fff;">${safeTitle}</h2>
        ${bodyHtml}
        ${safeCtaUrl && safeCtaText ? `<div style="text-align: center;"><a href="${safeCtaUrl}" class="btn" target="_blank" rel="noopener noreferrer">${safeCtaText}</a></div>` : ''}
      </div>
      <div class="footer">
        <div>${safeAppName} &mdash; Open-Source Vintage Telephone Switchboard</div>
        <div style="margin-top: 4px;">This is an automated system notification.</div>
      </div>
    </div>
  </div>
</body>
</html>
    `;
  }

  public static async sendPasswordResetEmail(email: string, username: string, resetToken: string, baseUrl: string): Promise<boolean> {
    const { transporter, fromAddress, appName } = await this.getTransporter();
    if (!transporter) {
      console.warn('[Email Warning] Cannot send password reset: SMTP not configured in Admin settings.');
      return false;
    }

    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    const safeUsername = escapeHtml(username);
    const safeAppName = escapeHtml(appName);

    const html = this.wrapEmailHtml(
      appName,
      'Password Reset Request',
      `
      <p>Hello <strong>@${safeUsername}</strong>,</p>
      <p>We received a request to reset the password for your ${safeAppName} switchboard account.</p>
      <p>Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
      `,
      resetUrl,
      'Reset My Password'
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: `[${appName}] Reset Your Switchboard Password`,
        html
      });
      console.log(`[Email] Password reset link sent to: ${email}`);
      return true;
    } catch (err) {
      console.error('[Email Error] Failed to send password reset:', err);
      return false;
    }
  }

  public static async sendWelcomeEmail(email: string, user: any, baseUrl: string): Promise<boolean> {
    const { transporter, fromAddress, appName } = await this.getTransporter();
    if (!transporter) return false;

    const safeDisplay = escapeHtml(user.displayName || user.username);
    const safeAppName = escapeHtml(appName);
    const safeExt = escapeHtml(user.phoneNumber || '---');

    const html = this.wrapEmailHtml(
      appName,
      'Welcome to Your New Switchboard Extension!',
      `
      <p>Hello <strong>${safeDisplay}</strong>,</p>
      <p>Your ${safeAppName} account has been created successfully. Your dedicated telephone extension is ready:</p>
      <div class="highlight-box">
        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase;">YOUR ASSIGNED EXTENSION:</div>
        <div class="ext-number">${safeExt}</div>
      </div>
      <p>You can now pair your ESP32-S3 rotary phone hardware, configure speed dials, and start making calls!</p>
      `,
      `${baseUrl}/onboarding`,
      'Open Setup Wizard'
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: `Welcome to ${appName}! Extension: ${user.phoneNumber}`,
        html
      });
      return true;
    } catch (err) {
      console.error('[Email Error] Failed to send welcome email:', err);
      return false;
    }
  }

  public static async sendVoicemailNotification(
    email: string,
    user: any,
    callerNumber: string,
    callerName: string,
    durationSec: number,
    baseUrl: string
  ): Promise<boolean> {
    const { transporter, fromAddress, appName } = await this.getTransporter();
    if (!transporter) return false;

    const safeDisplay = escapeHtml(user.displayName || user.display_name || user.username);
    const safeCallerName = escapeHtml(callerName);
    const safeCallerNum = escapeHtml(callerNumber);
    const safeDur = Math.max(0, Math.round(Number(durationSec) || 0));

    const html = this.wrapEmailHtml(
      appName,
      'New Voicemail Message Received',
      `
      <p>Hello <strong>${safeDisplay}</strong>,</p>
      <p>You have received a new zero-access encrypted voicemail message on your extension.</p>
      <div class="highlight-box" style="text-align: left; padding: 14px 20px;">
        <div><strong>Caller:</strong> ${safeCallerName} (EXT ${safeCallerNum})</div>
        <div style="margin-top: 4px;"><strong>Duration:</strong> ${safeDur} seconds</div>
        <div style="margin-top: 4px;"><strong>Security:</strong> ECIES P-256 + AES-256-GCM Sealed</div>
      </div>
      <p>You can listen to this message in your web browser or by lifting your physical rotary phone and dialing <strong>0</strong>.</p>
      `,
      `${baseUrl}/voicemail`,
      'Listen to Voicemail'
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: `[${appName}] New Voicemail from ${callerName} (${safeDur}s)`,
        html
      });
      return true;
    } catch (err) {
      console.error('[Email Error] Failed to send voicemail notification:', err);
      return false;
    }
  }

  public static async sendMissedCallNotification(
    email: string,
    user: any,
    callerNumber: string,
    callerName: string,
    baseUrl: string
  ): Promise<boolean> {
    const { transporter, fromAddress, appName } = await this.getTransporter();
    if (!transporter) return false;

    const safeDisplay = escapeHtml(user.displayName || user.display_name || user.username);
    const safeAppName = escapeHtml(appName);
    const safeCallerName = escapeHtml(callerName);
    const safeCallerNum = escapeHtml(callerNumber);

    const html = this.wrapEmailHtml(
      appName,
      'Missed Call Notification',
      `
      <p>Hello <strong>${safeDisplay}</strong>,</p>
      <p>You missed a call on your ${safeAppName} rotary phone from:</p>
      <div class="highlight-box">
        <div style="font-size: 18px; font-weight: bold; color: #38bdf8;">${safeCallerName}</div>
        <div style="color: #94a3b8; font-family: monospace; font-size: 14px; margin-top: 4px;">Extension ${safeCallerNum}</div>
      </div>
      `,
      baseUrl,
      'Open Switchboard'
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: `[${appName}] Missed call from ${callerName}`,
        html
      });
      return true;
    } catch (err) {
      console.error('[Email Error] Failed to send missed call notification:', err);
      return false;
    }
  }

  public static async sendTestEmail(toEmail: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
    const { transporter, fromAddress, appName } = await this.getTransporter();
    if (!transporter) {
      return { success: false, message: 'SMTP is not configured. Please fill in SMTP Host and credentials first.' };
    }

    const safeAppName = escapeHtml(appName);

    const html = this.wrapEmailHtml(
      appName,
      'SMTP Email Configuration Test',
      `
      <p>Congratulations! Your ${safeAppName} SMTP outbound mail dispatcher is configured and communicating properly.</p>
      <div class="highlight-box" style="color: #34d399; font-weight: 600;">
        ✅ SMTP Connection Verified Successfully
      </div>
      <p>All automated notifications (password resets, welcome greetings, missed call alerts, and voicemail alerts) will be delivered from this server.</p>
      `,
      baseUrl,
      'Go to Dashboard'
    );

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        subject: `[${appName}] Test Email from Switchboard`,
        html
      });
      return { success: true, message: `Test email successfully sent to ${toEmail}!` };
    } catch (err: any) {
      console.error('[Email Error] SMTP Test failed:', err);
      return { success: false, message: `SMTP connection failed: ${err.message}` };
    }
  }
}
