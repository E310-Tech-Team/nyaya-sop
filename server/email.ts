/**
 * Outgoing email. Three transports:
 * - smtp: real delivery through the configured provider (nodemailer).
 * - outbox: a local test adapter that keeps messages in memory. Refused in production
 *   (config.ts); readable only at the development-only /api/dev/outbox page and in tests.
 * - none: nothing can be sent, so sign-in by email and email invitations are switched off
 *   rather than pretending a message went out.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { isLoopbackHost, type AppConfig, type EmailTransportKind } from './config';

export type EmailPurpose = 'applicant_sign_in' | 'staff_invite' | 'staff_password_reset' | 'staff_email_code' | 'staff_security';
export type EmailMessage = { to: string; subject: string; text: string; html: string; purpose: EmailPurpose };

export interface EmailTransport {
  readonly kind: EmailTransportKind;
  readonly canSend: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class OutboxTransport implements EmailTransport {
  readonly kind = 'outbox' as const;
  readonly canSend = true;
  readonly messages: (EmailMessage & { sentAt: Date })[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push({ ...message, sentAt: new Date() });
    if (this.messages.length > 100) this.messages.shift();
  }

  /** Most recent message to `to` (tests). */
  latest(to?: string) {
    return [...this.messages].reverse().find((message) => !to || message.to === to) ?? null;
  }
}

/**
 * smtp:// upgrades to TLS only when the server offers it, and anyone on the path can remove the
 * offer and read the password and the sign-in links: TLS is required, except for a relay on this
 * computer. (SMTP_URL can still say ?requireTLS=false for a relay without TLS on a private network.)
 */
export function smtpConnection(url: string): string | { url: string; requireTLS: true } {
  return isLoopbackHost(new URL(url).hostname) ? url : { url, requireTLS: true };
}

class SmtpTransport implements EmailTransport {
  readonly kind = 'smtp' as const;
  readonly canSend = true;
  readonly #transporter: Transporter;
  readonly #from: string;

  constructor(url: string, from: string) {
    this.#transporter = nodemailer.createTransport(smtpConnection(url));
    this.#from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    // An address object is used as given: a string would be parsed, and could become a list.
    const to = { name: '', address: message.to };
    await this.#transporter.sendMail({ from: this.#from, to, subject: message.subject, text: message.text, html: message.html });
  }
}

class DisabledTransport implements EmailTransport {
  readonly kind = 'none' as const;
  readonly canSend = false;
  async send(): Promise<void> {
    throw new Error('Email is not configured');
  }
}

export function createEmailTransport(config: AppConfig): EmailTransport {
  if (config.email.transport === 'smtp' && config.email.smtpUrl && config.email.from) {
    return new SmtpTransport(config.email.smtpUrl, config.email.from);
  }
  if (config.email.transport === 'outbox') return new OutboxTransport();
  return new DisabledTransport();
}

// ── Templates ────────────────────────────────────────────────────────────────

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The email's HTML. `action` is a button with its link; `code` is a one-time code shown large (no link). */
function layout(heading: string, paragraphs: string[], action: { label: string; url: string } | null, footer: string, code?: string): string {
  const p = (text: string) => `<p style="margin:0 0 16px;font:15px/1.6 Arial,sans-serif;color:#202124">${escapeHtml(text)}</p>`;
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f3f0e6;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d8d0c3;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font:11px/1.4 Arial,sans-serif;letter-spacing:3px;color:#841d26">RCCG NYAYA<br><span style="font-size:15px;font-weight:900;letter-spacing:.6px">SCHOOL OF PURPOSE</span></p>
<h1 style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#202124">${escapeHtml(heading)}</h1>
${paragraphs.map(p).join('')}
${code ? `<p style="margin:8px 0 24px;font:700 32px/1.2 'Courier New',monospace;letter-spacing:8px;color:#202124">${escapeHtml(code)}</p>` : ''}
${
  action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#841d26;color:#fff;text-decoration:none;font:700 15px Arial,sans-serif;padding:12px 22px;border-radius:999px">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font:13px/1.5 Arial,sans-serif;color:#665d60">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : ''
}
<p style="margin:16px 0 0;font:13px/1.5 Arial,sans-serif;color:#665d60">${escapeHtml(footer)}</p>
</div></body></html>`;
}

export function signInEmail(to: string, url: string, minutes: number): EmailMessage {
  const lines = [
    'Use the button below to sign in to your School of Purpose account.',
    `The link works once and expires in ${minutes} minutes.`,
  ];
  const footer = "If you didn't ask to sign in, you can ignore this email: nothing happens unless the link is used.";
  return {
    to,
    purpose: 'applicant_sign_in',
    subject: 'Your School of Purpose sign-in link',
    text: `${lines.join('\n\n')}\n\nSign in: ${url}\n\n${footer}\n`,
    html: layout('Sign in to School of Purpose', lines, { label: 'Sign in', url }, footer),
  };
}

export function staffInviteEmail(to: string, url: string, hours: number): EmailMessage {
  const lines = [
    'You have been invited to the School of Purpose admin area.',
    `Use the link below to choose a password and set up two-step verification. It works once and expires in ${hours} hours.`,
  ];
  const footer = "If you weren't expecting this, you can ignore it.";
  return {
    to,
    purpose: 'staff_invite',
    subject: 'Your School of Purpose admin invitation',
    text: `${lines.join('\n\n')}\n\nSet up your account: ${url}\n\n${footer}\n`,
    html: layout('Admin invitation', lines, { label: 'Set up your account', url }, footer),
  };
}

export function staffResetEmail(to: string, url: string, minutes: number): EmailMessage {
  const lines = [
    'Someone asked to reset the password for this School of Purpose admin account.',
    `The link works once and expires in ${minutes} minutes. You will also need your two-step verification code.`,
  ];
  const footer = "If this wasn't you, ignore this email and tell the site owner.";
  return {
    to,
    purpose: 'staff_password_reset',
    subject: 'Reset your School of Purpose admin password',
    text: `${lines.join('\n\n')}\n\nReset your password: ${url}\n\n${footer}\n`,
    html: layout('Reset your password', lines, { label: 'Reset password', url }, footer),
  };
}

/** A one-time code for the admin's second step or a security change. No link: the code is typed in on the site. */
export function staffEmailCodeEmail(to: string, code: string, minutes: number): EmailMessage {
  const lines = [`Here is your School of Purpose admin code. It works once and expires in ${minutes} minutes.`];
  const footer = "Never share this code. If you didn't just ask for it, someone may have your password: change it and tell the site owner.";
  return {
    to,
    purpose: 'staff_email_code',
    subject: 'Your School of Purpose admin code',
    text: `${lines.join('\n\n')}\n\n${code}\n\n${footer}\n`,
    html: layout('Your admin code', lines, null, footer, code),
  };
}

export type StaffSecurityChange =
  | 'passkey_added'
  | 'passkey_removed'
  | 'app_added'
  | 'app_replaced'
  | 'app_removed'
  | 'email_codes_on'
  | 'email_codes_off'
  | 'recovery_codes_replaced'
  | 'methods_reset';

const SECURITY_CHANGES: Record<StaffSecurityChange, string> = {
  passkey_added: 'A passkey was added to your School of Purpose admin account.',
  passkey_removed: 'A passkey was removed from your School of Purpose admin account.',
  app_added: 'An authenticator app was set up for your School of Purpose admin account.',
  app_replaced: 'The authenticator app for your School of Purpose admin account was replaced. Codes from the old one no longer work.',
  app_removed: 'The authenticator app was removed from your School of Purpose admin account.',
  email_codes_on: 'Signing in to your School of Purpose admin account with a code sent by email was turned on.',
  email_codes_off: 'Signing in to your School of Purpose admin account with a code sent by email was turned off.',
  recovery_codes_replaced: 'New recovery codes were created for your School of Purpose admin account. The old ones no longer work.',
  methods_reset: 'An owner reset the two-step verification on your School of Purpose admin account. You will set it up again when you next sign in.',
};

/** Tells a staff member that their sign-in methods changed (06 D-58). */
export function staffSecurityEmail(to: string, change: StaffSecurityChange): EmailMessage {
  const lines = [SECURITY_CHANGES[change]];
  const footer = "If this wasn't you, change your password and tell the site owner straight away.";
  return {
    to,
    purpose: 'staff_security',
    subject: 'Your School of Purpose admin sign-in methods changed',
    text: `${lines.join('\n\n')}\n\n${footer}\n`,
    html: layout('Your sign-in methods changed', lines, null, footer),
  };
}
