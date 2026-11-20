// Sends one sample sign-in code email through the configured transport, to check delivery.
//
//   npm run email:test -w @carelayer/api -- you@example.com
//
// Uses EMAIL_TRANSPORT / EMAIL_FROM / EMAIL_API_KEY from apps/api/.env. The code in the email is a
// random sample: it is not stored and cannot be used to sign in.
import { createLogger } from '../src/lib/logger.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { generateCode } from '../src/modules/auth/crypto.js';
import { createEmailSender } from '../src/modules/auth/email.js';

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Usage: npm run email:test -w @carelayer/api -- you@example.com');
  process.exit(1);
}

try {
  const config = loadConfig();
  const sender = createEmailSender(config.auth, createLogger('info'));
  const started = Date.now();
  await sender.sendCode({ to, code: generateCode(), purpose: 'login', expiresInMinutes: 10 });
  console.log(
    `[email:test] sent via ${config.auth.emailTransport} from ${config.auth.emailFrom ?? '(console)'} to ${to} in ${Date.now() - started} ms`,
  );
} catch (err) {
  console.error(
    `[email:test] failed: ${err instanceof ConfigError ? err.message : (err as Error).message}`,
  );
  process.exit(1);
}
