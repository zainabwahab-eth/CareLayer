// Sending sign-in codes. Every send goes through EmailSender so tests capture codes and the
// provider can change without touching auth logic.
//   console  development only: prints the code in the API log. Config refuses it in production.
//   resend   Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
import { createHash } from 'node:crypto';
import type { CodePurpose } from '@carelayer/shared';
import type { AuthConfig } from '../../config.js';
import type { Logger } from '../../lib/logger.js';

export interface CodeEmail {
  to: string;
  code: string;
  purpose: CodePurpose;
  /** Minutes until the code expires. */
  expiresInMinutes: number;
}

/**
 * "A question is waiting" alert to a nurse (Z6). Deliberately says only the topic: the question
 * itself stays inside the nurse app, behind sign-in, never in an inbox.
 */
export interface NurseAlertEmail {
  to: string;
  /** Display label, e.g. "Pregnancy". */
  topicLabel: string;
  /** True when she chose this nurse: "sent to you" wording. */
  chosenForYou: boolean;
  /** Where the nurse opens it (nurse app). */
  url: string;
  /** Idempotency: one alert per (question, nurse). */
  questionId: string;
}

export interface EmailSender {
  sendCode(email: CodeEmail): Promise<void>;
  sendNurseAlert(email: NurseAlertEmail): Promise<void>;
}

const SUBJECTS: Record<CodePurpose, string> = {
  signup: 'Your CareLayer sign-up code',
  login: 'Your CareLayer sign-in code',
  step_up: 'Confirm it is you',
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function codeEmailText(email: CodeEmail): { subject: string; text: string; html: string } {
  const subject = SUBJECTS[email.purpose];
  const text = `Your CareLayer code is ${email.code}. It expires in ${email.expiresInMinutes} minutes. If you did not ask for it, you can ignore this email.`;
  const code = escapeHtml(email.code);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F5F2;font-family:Arial,Helvetica,sans-serif;color:#13201D">
<div style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:32px">
<p style="margin:0 0 8px;font-size:15px;color:#55635F">CareLayer</p>
<h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${escapeHtml(subject)}</h1>
<p style="margin:0 0 8px;font-size:15px">Your code is</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#0F4A43">${code}</p>
<p style="margin:0 0 16px;font-size:15px">It expires in ${email.expiresInMinutes} minutes.</p>
<p style="margin:0;font-size:13px;color:#55635F">If you did not ask for it, you can ignore this email.</p>
</div></body></html>`;
  return { subject, text, html };
}

export function nurseAlertEmailText(email: NurseAlertEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = email.chosenForYou
    ? `A woman chose you for a ${email.topicLabel.toLowerCase()} question`
    : `A new ${email.topicLabel.toLowerCase()} question is waiting`;
  const lead = email.chosenForYou
    ? 'A woman chose you to answer her question. It is reserved for you for 10 minutes.'
    : 'A new question in one of your topics is waiting for a nurse or midwife.';
  const text = `${lead} Open CareLayer to read and claim it: ${email.url}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F5F2;font-family:Arial,Helvetica,sans-serif;color:#13201D">
<div style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:32px">
<p style="margin:0 0 8px;font-size:15px;color:#55635F">CareLayer · ${escapeHtml(email.topicLabel)}</p>
<h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${escapeHtml(subject)}</h1>
<p style="margin:0 0 24px;font-size:15px">${escapeHtml(lead)}</p>
<a href="${escapeHtml(email.url)}" style="display:inline-block;background:#0F4A43;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:14px 20px;border-radius:14px">Open CareLayer</a>
<p style="margin:24px 0 0;font-size:13px;color:#55635F">You get these because you are available for this topic. Change it in your profile.</p>
</div></body></html>`;
  return { subject, text, html };
}

/** Development only: prints the code so you can sign in locally. */
export function createConsoleEmailSender(logger: Logger): EmailSender {
  return {
    async sendCode(email) {
      const { subject } = codeEmailText(email);
      logger.info('dev_email_code', { to: email.to, subject, code: email.code });
    },
    async sendNurseAlert(email) {
      const { subject } = nurseAlertEmailText(email);
      logger.info('dev_email_nurse_alert', { to: email.to, subject, url: email.url });
    },
  };
}

export const RESEND_API_URL = 'https://api.resend.com/emails';

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/**
 * Resend transport. Throws EmailSendError on any failure (the auth service turns it into 503).
 * The error message carries Resend's error name/message, never the API key or the code.
 * An Idempotency-Key (hash of recipient + code) stops a retried request sending the email twice.
 */
export function createResendEmailSender(
  opts: { apiKey: string; from: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  async function send(
    to: string,
    content: { subject: string; text: string; html: string },
    idempotencySeed: string,
  ) {
    let res: Response;
    try {
      res = await fetchImpl(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': createHash('sha256').update(idempotencySeed).digest('hex'),
        },
        body: JSON.stringify({ from: opts.from, to: [to], ...content }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown';
      throw new EmailSendError(`Resend request failed (${reason})`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
      throw new EmailSendError(
        `Resend rejected the email: ${res.status} ${body.name ?? ''} ${body.message ?? ''}`.trim(),
        res.status,
      );
    }
  }

  return {
    async sendCode(email) {
      await send(email.to, codeEmailText(email), `${email.to}\0${email.code}`);
    },
    async sendNurseAlert(email) {
      await send(email.to, nurseAlertEmailText(email), `alert\0${email.to}\0${email.questionId}`);
    },
  };
}

/** Picks the transport from config. */
export function createEmailSender(cfg: AuthConfig, logger: Logger): EmailSender {
  if (cfg.emailTransport === 'resend') {
    if (!cfg.emailApiKey || !cfg.emailFrom) {
      throw new Error('EMAIL_TRANSPORT=resend needs EMAIL_API_KEY and EMAIL_FROM');
    }
    return createResendEmailSender({ apiKey: cfg.emailApiKey, from: cfg.emailFrom });
  }
  return createConsoleEmailSender(logger);
}
