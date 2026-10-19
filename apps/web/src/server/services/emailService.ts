import { Resend } from 'resend';
import { db } from '../db/index';
import { emailLogs } from '../db/schema';
import { LOGO_EMAIL_PNG_BASE64 } from '../assets/logoEmail';
import { background } from '../lib/background';
import { siteUrl } from '../lib/publicUrl';

const FROM = process.env.EMAIL_FROM || 'Voice Tunes India <onboarding@resend.dev>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The logo travels inside each email as an inline attachment, so it shows even when the
// website isn't publicly reachable.
const LOGO_CID = 'vti-logo';
const LOGO_PNG: Buffer | null = Buffer.from(LOGO_EMAIL_PNG_BASE64, 'base64');

async function logEmail(entry: typeof emailLogs.$inferInsert): Promise<void> {
  try {
    await db.insert(emailLogs).values(entry);
  } catch (err) {
    console.error('[Email] Failed to write email log:', (err as Error).message);
  }
}

/**
 * Never throws. Request handlers call this without awaiting (`void sendEmail(...)`) so API
 * responses don't wait on the email provider; the send is registered as background work so it still
 * completes on Vercel after the response has gone out.
 */
export function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  template?: string
): Promise<{ id?: string; error?: Error }> {
  return background(deliver(to, subject, html, template), 'Email').then((r) => r ?? {});
}

async function deliver(
  to: string | string[],
  subject: string,
  html: string,
  template?: string
): Promise<{ id?: string; error?: Error }> {
  const toArr = Array.isArray(to) ? to : [to];
  const base = { template: template || 'unknown', to: toArr, subject };
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email to:', toArr);
    await logEmail({ ...base, status: 'failed', error: 'No API key' });
    return {};
  }
  try {
    const attachments = LOGO_PNG && html.includes(`cid:${LOGO_CID}`)
      ? [{ filename: 'voice-tunes-india.png', content: LOGO_PNG, inlineContentId: LOGO_CID }]
      : undefined;
    const { data, error } = await resend.emails.send({ from: FROM, to: toArr, subject, html, attachments });
    if (error) {
      console.error('[Email] Resend error:', error);
      await logEmail({ ...base, status: 'failed', error: String(error.message ?? error) });
      return { error: new Error(String(error.message ?? error)) };
    }
    console.log(`[Email] Sent "${subject}" → ${toArr.join(', ')} (id: ${data?.id})`);
    await logEmail({ ...base, status: 'sent', resendId: data?.id });
    return { id: data?.id };
  } catch (err) {
    console.error('[Email] Unexpected error:', err);
    await logEmail({ ...base, status: 'failed', error: String(err) });
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(accentColor: string, title: string, body: string): string {
  const brand = LOGO_PNG
    ? `<img src="cid:${LOGO_CID}" width="160" height="73" alt="Voice Tunes India" style="display:block;border:0;width:160px;height:auto;"/>`
    : `<span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Voice Tunes India</span>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:28px 36px;">
      ${brand}
    </td>
  </tr>
  <!-- Accent bar -->
  <tr><td style="height:4px;background:${accentColor};line-height:4px;font-size:0;">&nbsp;</td></tr>
  <!-- Body -->
  <tr><td style="padding:36px 36px 28px;">${body}</td></tr>
  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.7;">
        Voice Tunes India<br/>
        This email was sent automatically. Please do not reply.
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function h1(text: string, color = '#0f172a') {
  return `<h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:${color};letter-spacing:-0.3px;">${text}</h1>`;
}
function para(text: string) {
  return `<p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.7;">${text}</p>`;
}
function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;width:130px;">${label}</td>
    <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;">${value}</td>
  </tr>`;
}
function infoTable(rows: Array<[string, string]>, bg = '#f8fafc') {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid #e2e8f0;border-radius:10px;margin-bottom:24px;overflow:hidden;">
    ${rows.map(([l, v]) => infoRow(l, v)).join('')}
  </table>`;
}
function cta(text: string, href: string, color = '#0ea5e9') {
  return `<table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
    <tr><td style="background:${color};border-radius:8px;">
      <a href="${href}" style="display:block;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;">${text} &rarr;</a>
    </td></tr>
  </table>`;
}
function badge(text: string) {
  return `<span style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;">${text}</span>`;
}
function alertBox(text: string, bg = '#fef9c3', border = '#fde68a', textColor = '#92400e') {
  return `<p style="margin:0 0 20px;font-size:14px;color:${textColor};background:${bg};border:1px solid ${border};border-radius:8px;padding:12px 16px;line-height:1.6;">${text}</p>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

/** Welcome email — sent when admin creates a new user account */
export function welcomeUserTemplate(params: {
  name: string;
  username: string;
  password: string;
  role: string;
  loginUrl: string;
}): string {
  const roleLabel = params.role.replace(/_/g, ' ');
  const body = `
    ${h1('Welcome to Voice Tunes India! 🎉')}
    ${para(`Hi <strong>${params.name}</strong>,<br/>Your account has been created by your administrator. Use the credentials below to sign in.`)}
    ${infoTable([
      ['Full Name', params.name],
      ['Username', `<code style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-family:monospace;">${params.username}</code>`],
      ['Password', `<code style="background:#fef9c3;padding:2px 10px;border-radius:4px;font-family:monospace;font-weight:700;color:#92400e;">${params.password}</code>`],
      ['Role', badge(roleLabel)],
    ])}
    ${alertBox('⚠️ &nbsp;Please change your password immediately after your first sign-in.')}
    ${cta('Sign In to Voice Tunes India', params.loginUrl, '#0ea5e9')}
    ${para('If you have any questions, contact your administrator.')}
  `;
  return layout('linear-gradient(90deg,#0ea5e9,#6366f1)', 'Welcome to Voice Tunes India', body);
}

/** Task assigned */
export function taskAssignedTemplate(params: {
  taskName: string;
  projectName: string;
  deadline?: string;
  assignedBy: string;
}): string {
  const rows: Array<[string, string]> = [
    ['📋 Task', `<strong>${params.taskName}</strong>`],
    ['📁 Project', params.projectName],
    ['👤 Assigned by', params.assignedBy],
  ];
  if (params.deadline) rows.push(['⏰ Deadline', `<strong style="color:#dc2626;">${params.deadline}</strong>`]);
  const body = `
    ${h1('New Task Assigned')}
    ${para(`<strong>${params.assignedBy}</strong> has assigned you a new task. Please review the details below and get started.`)}
    ${infoTable(rows, '#f0f9ff')}
    ${cta('View My Tasks', `${siteUrl()}/tasks`, '#0ea5e9')}
  `;
  return layout('#0ea5e9', 'New Task Assigned', body);
}

/** Task completed — sent to admins */
export function taskCompletedTemplate(params: {
  taskName: string;
  projectName: string;
  completedBy: string;
  completedAt: string;
}): string {
  const body = `
    ${h1('Task Completed ✅', '#166534')}
    ${para('A task has been marked as <strong>completed</strong>.')}
    ${infoTable([
      ['📋 Task', `<strong>${params.taskName}</strong>`],
      ['📁 Project', params.projectName],
      ['👤 Completed by', params.completedBy],
      ['🕐 Completed at', params.completedAt],
    ], '#f0fdf4')}
    ${cta('View Project', `${siteUrl()}/projects`, '#16a34a')}
  `;
  return layout('#16a34a', 'Task Completed', body);
}

/** Deadline reminder */
export function deadlineReminderTemplate(params: {
  taskName: string;
  projectName: string;
  deadline: string;
}): string {
  const body = `
    ${h1('⏰ Deadline Reminder', '#b91c1c')}
    ${para('This task is due within the next <strong>24 hours</strong>. Please ensure it is completed on time.')}
    ${infoTable([
      ['📋 Task', `<strong>${params.taskName}</strong>`],
      ['📁 Project', params.projectName],
      ['⏰ Deadline', `<strong style="color:#dc2626;">${params.deadline}</strong>`],
    ], '#fef2f2')}
    ${cta('Open Task Now', `${siteUrl()}/tasks`, '#dc2626')}
  `;
  return layout('#dc2626', 'Deadline Reminder', body);
}

/** Client approval required */
export function approvalRequiredTemplate(params: {
  taskName: string;
  projectName: string;
}): string {
  const body = `
    ${h1('Action Required: Review Deliverable')}
    ${para('Your team has completed a deliverable and it is ready for your review and approval.')}
    ${infoTable([
      ['📋 Deliverable', `<strong>${params.taskName}</strong>`],
      ['📁 Project', params.projectName],
    ], '#eff6ff')}
    ${para('Please log in to the client portal to approve or request revisions.')}
    ${cta('Review in Client Portal', `${siteUrl()}/portal/approvals`, '#2563eb')}
  `;
  return layout('#2563eb', 'Approval Required', body);
}

/** Client approved */
export function approvalApprovedTemplate(params: {
  taskName: string;
  projectName: string;
}): string {
  const body = `
    ${h1('Deliverable Approved 🎉', '#166534')}
    ${para('Great news! The client has <strong>approved</strong> your deliverable.')}
    ${infoTable([
      ['📋 Deliverable', `<strong>${params.taskName}</strong>`],
      ['📁 Project', params.projectName],
    ], '#f0fdf4')}
    ${cta('View Project', `${siteUrl()}/projects`, '#16a34a')}
  `;
  return layout('#16a34a', 'Deliverable Approved', body);
}

/** Client rejected */
export function approvalRejectedTemplate(params: {
  taskName: string;
  projectName: string;
  reason?: string;
}): string {
  const rows: Array<[string, string]> = [
    ['📋 Deliverable', `<strong>${params.taskName}</strong>`],
    ['📁 Project', params.projectName],
  ];
  if (params.reason) rows.push(['💬 Feedback', params.reason]);
  const body = `
    ${h1('Deliverable Needs Revision', '#b91c1c')}
    ${para('The client has requested changes to this deliverable. Please review the feedback and update accordingly.')}
    ${infoTable(rows, '#fef2f2')}
    ${alertBox('ℹ️ &nbsp;The task has been moved back to <strong>In Progress</strong>.', '#eff6ff', '#bfdbfe', '#1d4ed8')}
    ${cta('View Task', `${siteUrl()}/tasks`, '#dc2626')}
  `;
  return layout('#dc2626', 'Deliverable Rejected', body);
}

/** Password reset */
export function passwordResetTemplate(params: {
  resetUrl: string;
  expiresIn: string;
}): string {
  const body = `
    ${h1('Reset Your Password')}
    ${para('We received a request to reset your Voice Tunes India password. Click the button below to set a new one.')}
    ${alertBox(`🔒 &nbsp;This link expires in <strong>${params.expiresIn}</strong>. If you did not request this, you can safely ignore this email.`)}
    ${cta('Reset My Password', params.resetUrl, '#0ea5e9')}
    ${para('Or copy and paste this link into your browser:')}
    <p style="word-break:break-all;font-size:12px;color:#94a3b8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;margin:0 0 20px;">${params.resetUrl}</p>
  `;
  return layout('#0ea5e9', 'Reset Your Password', body);
}
