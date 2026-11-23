import { DEFAULT_ANSWER_PRICE_KOBO } from '@carelayer/shared';
import { ButtonLink } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { formatTime } from '@web/utils/dates';
import { formatNaira } from '@web/utils/money';
import { useLocation } from 'react-router';
import { casesPath, paths } from '../routes/paths';
import { ANSWER_SHARE_KOBO } from '../workspace/format';
import styles from '../workspace/workspace.module.css';
import type { AnswerSentState } from './CasePage';

/*
 * N08 Answer sent (Figma: Nurse -mobile / N08).
 *
 * The frame says "Paid to your wallet the moment she received it" with a Stellar
 * link. apps/api pays on delivery: the payout happens when she OPENS the answer
 * (POST /me/questions/:id/collect), not when it is sent, and the answer call
 * returns no payment. So this screen says that, and the payment appears on
 * Earnings once it lands (docs/QUESTIONS.md Q6).
 */
function readState(state: unknown): AnswerSentState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Partial<AnswerSentState>;
  return typeof s.answeredAt === 'string' ? (s as AnswerSentState) : null;
}

export function AnswerSentPage() {
  const sent = readState(useLocation().state);

  return (
    <div className={styles.page} style={{ paddingTop: 'var(--space-32)' }}>
      <span
        className={styles.listIcon}
        style={{
          width: '4.5rem',
          height: '4.5rem',
          background: 'var(--color-primary)',
          color: 'var(--color-on-primary)',
        }}
        aria-hidden
      >
        <Icon name="check" size={32} />
      </span>
      <h1 className={styles.title}>Answer delivered.</h1>
      <p className={styles.lede}>
        You earn {formatNaira(ANSWER_SHARE_KOBO)} when she opens it. It is paid to your wallet on
        Stellar the moment she does.
      </p>

      <section className={styles.card} aria-label="Payment details">
        <ul role="list" className={styles.list}>
          <li className={styles.listItem}>
            <span className={styles.muted}>Answer price</span>
            <span className={styles.label}>{formatNaira(DEFAULT_ANSWER_PRICE_KOBO)}</span>
          </li>
          <li className={styles.listItem}>
            <span className={styles.muted}>Your share (80%)</span>
            <span className={styles.amountIn}>{formatNaira(ANSWER_SHARE_KOBO)}</span>
          </li>
          {sent && (
            <li className={styles.listItem}>
              <span className={styles.muted}>Sent</span>
              <span className={styles.label}>{formatTime(sent.answeredAt)}</span>
            </li>
          )}
          <li className={styles.listItem}>
            <span className={styles.muted}>Payment</span>
            <span className={cx(styles.label)}>When she opens it, USDC on Stellar</span>
          </li>
        </ul>
      </section>
      {sent?.recommendSeeSomeoneToday && (
        <p className={cx(styles.bodySmall, styles.muted)}>
          You recommended she sees someone today. She sees this at the top of your answer.
        </p>
      )}
      <p className={cx(styles.bodySmall, styles.muted)}>
        If she never opens it, nothing is charged and nothing is paid. Free answers are still paid
        to you by CareLayer.
      </p>

      <div
        className={styles.stack}
        style={{ gap: 'var(--space-12)', marginTop: 'var(--space-16)' }}
      >
        <ButtonLink to={casesPath()} fullWidth>
          Next case
        </ButtonLink>
        <ButtonLink to={paths.earnings} variant="secondary" fullWidth>
          See earnings
        </ButtonLink>
        <ButtonLink to={paths.today} variant="ghost" fullWidth>
          Back to today
        </ButtonLink>
      </div>
    </div>
  );
}
