// Sending sign-in codes. Every send goes through EmailSender so tests capture codes and the
// provider can change without touching auth logic. Only the console transport exists until Z11
// picks a provider; config refuses it in production (codes must never land in logs there).
import type { CodePurpose } from '@carelayer/shared';
import type { Logger } from '../../lib/logger.js';

export interface CodeEmail {
  to: string;
  code: string;
  purpose: CodePurpose;
  /** Minutes until the code expires. */
  expiresInMinutes: number;
}

export interface EmailSender {
  sendCode(email: CodeEmail): Promise<void>;
}

const SUBJECTS: Record<CodePurpose, string> = {
  signup: 'Your CareLayer sign-up code',
  login: 'Your CareLayer sign-in code',
  step_up: 'Confirm it is you',
};

export function codeEmailText(email: CodeEmail): { subject: string; text: string } {
  return {
    subject: SUBJECTS[email.purpose],
    text: `Your CareLayer code is ${email.code}. It expires in ${email.expiresInMinutes} minutes. If you did not ask for it, you can ignore this email.`,
  };
}

/** Development only: prints the code so you can sign in locally. */
export function createConsoleEmailSender(logger: Logger): EmailSender {
  return {
    async sendCode(email) {
      const { subject } = codeEmailText(email);
      logger.info('dev_email_code', { to: email.to, subject, code: email.code });
    },
  };
}
