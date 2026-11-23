import {
  MIN_WITHDRAWAL_KOBO,
  stellarExplorerUrl,
  type EarningsActivity,
  type EarningsResponse,
} from '@carelayer/shared';
import { ButtonLink } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { categoryLabel } from '@web/utils/categories';
import { formatFullDate, formatListDate, formatTime } from '@web/utils/dates';
import { formatNaira } from '@web/utils/money';
import { Link } from 'react-router';
import { paths } from '../routes/paths';
import { EmptyState, LoadError, Skeleton } from '../workspace/components';
import { ANSWER_SHARE_KOBO, shortAddress } from '../workspace/format';
import { useNow, useNurseQuery } from '../workspace/hooks';
import styles from '../workspace/workspace.module.css';

/*
 * N09 Earnings (Figma: Nurse -mobile / N09). GET /nurse/earnings.
 * Any signed-in nurse (earned money stays hers whatever her status, contract §12).
 * Refreshes every 30 s, so a payment that lands while she looks shows up.
 */
export function EarningsPage() {
  const earnings = useNurseQuery((api) => api.earnings.get(), [], { pollMs: 30_000 });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Earnings</h1>
      </header>
      {earnings.status === 'loading' && <Skeleton count={3} height="9rem" />}
      {earnings.status === 'error' && (
        <LoadError
          error={earnings.error}
          fallback="We could not load your earnings."
          onRetry={earnings.reload}
        />
      )}
      {earnings.data && <EarningsBody data={earnings.data} />}
    </div>
  );
}

function EarningsBody({ data }: { data: EarningsResponse }) {
  const now = useNow(60_000);
  const canWithdraw = data.available.kobo >= MIN_WITHDRAWAL_KOBO;
  const stale =
    data.balanceSyncedAt !== null && now - Date.parse(data.balanceSyncedAt) > 5 * 60_000;
  const max = Math.max(...data.thisWeek.days.map((d) => d.total.kobo), 1);

  return (
    <div className={styles.grid}>
      <section className={styles.primaryCard} aria-label="Available to withdraw">
        <span className={styles.muted}>Available to withdraw</span>
        <span
          className={styles.title}
          style={{ color: 'inherit', fontSize: 'var(--text-display-l-size)' }}
        >
          {formatNaira(data.available)}
        </span>
        <span className={cx(styles.bodySmall, styles.muted)}>
          Held as USDC in your wallet on Stellar
          {data.balance.kobo !== data.available.kobo &&
            `. ${formatNaira(data.balance.kobo - data.available.kobo)} is on its way out.`}
        </span>
        {stale && data.balanceSyncedAt && (
          <span className={cx(styles.caption, styles.muted)}>
            Stellar is slow to answer. Last checked {formatListDate(data.balanceSyncedAt)},{' '}
            {formatTime(data.balanceSyncedAt)}.
          </span>
        )}
        {canWithdraw ? (
          <ButtonLink to={paths.withdraw} variant="secondary" fullWidth>
            Withdraw
          </ButtonLink>
        ) : (
          <span className={cx(styles.bodySmall, styles.muted)}>
            You can withdraw once you have {formatNaira(MIN_WITHDRAWAL_KOBO)} or more.
          </span>
        )}
      </section>

      <section className={styles.card} aria-label="This week">
        <div className={styles.row}>
          <h2 className={styles.cardTitle}>This week</h2>
          <span className={cx(styles.bodySmall, styles.muted)}>
            {formatNaira(data.thisWeek.total)} from {data.thisWeek.answersCount} answers
          </span>
        </div>
        <div className={styles.chart} role="img" aria-label={chartLabel(data)}>
          {data.thisWeek.days.map((day) => (
            <div key={day.date} className={styles.barColumn}>
              <span
                className={cx(styles.bar, day.isToday && styles.barToday)}
                style={{ height: `${Math.max(6, (day.total.kobo / max) * 100)}%` }}
              />
              <span className={cx(styles.caption, day.isToday ? styles.label : styles.muted)}>
                {day.weekday.charAt(0).toUpperCase() + day.weekday.slice(1)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section
        className={styles.stats}
        aria-label="Totals"
        style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
      >
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatNaira(data.thisMonth.total)}</span>
          <span className={styles.statLabel}>
            This month · {data.thisMonth.answersCount} answers
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatNaira(data.totalEarned)}</span>
          <span className={styles.statLabel}>All time · {data.answersCount} answers</span>
        </div>
      </section>

      <section className={styles.card} aria-label="Wallets">
        <h2 className={styles.cardTitle}>Where your money goes</h2>
        <div className={styles.stack}>
          <span className={styles.muted}>Your CareLayer wallet</span>
          <a
            className={cx(styles.address, styles.link)}
            href={stellarExplorerUrl('account', data.stellarAddress)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(data.stellarAddress)} · View on Stellar
          </a>
        </div>
        <p className={cx(styles.bodySmall, styles.muted)}>
          {data.payoutAddress
            ? `Payouts go to your own wallet ${shortAddress(data.payoutAddress)}, so they do not add to the balance above.`
            : 'Payouts land in your CareLayer wallet. You can choose your own wallet in Settings.'}
        </p>
        <Link to={paths.settings} className={styles.link}>
          Change payout wallet
        </Link>
      </section>

      <section className={cx(styles.stack, styles.gridWide)} style={{ gap: 'var(--space-12)' }}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent payments</h2>
          <Link to={paths.withdrawals} className={styles.link}>
            See all
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <EmptyState icon="wallet" title="No payments yet">
            You are paid {formatNaira(ANSWER_SHARE_KOBO)} each time a woman opens one of your
            answers.
          </EmptyState>
        ) : (
          <div className={styles.card}>
            <ul role="list" className={styles.list}>
              {data.recent.map((entry) => (
                <ActivityRow key={`${entry.kind}-${entry.id}`} entry={entry} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function chartLabel(data: EarningsResponse): string {
  const days = data.thisWeek.days
    .map((d) => `${d.weekday}: ${formatNaira(d.total)}${d.isToday ? ' (today)' : ''}`)
    .join(', ');
  return `Earnings this week. ${days}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Being sent to your wallet',
  confirmed: 'Confirmed on Stellar',
  submitted: 'Processing',
  failed: 'Failed, nothing left your wallet',
};

/** One payment or withdrawal. Tap to see its details (status, time, transaction). */
export function ActivityRow({ entry }: { entry: EarningsActivity }) {
  const earning = entry.kind === 'earning';
  const at = earning ? entry.earnedAt : entry.createdAt;
  const title = earning ? entry.title : 'Withdrawal to Stellar wallet';
  return (
    <li className={styles.listItem} style={{ display: 'block' }}>
      <details>
        <summary className={styles.row} style={{ cursor: 'pointer', listStyle: 'none' }}>
          <span className={styles.rowStart}>
            <span className={styles.listIcon} aria-hidden>
              <Icon name={earning ? 'heart' : 'send'} size={18} />
            </span>
            <span className={styles.stack}>
              <span className={styles.label}>{title}</span>
              <span className={cx(styles.caption, styles.muted)}>
                {formatListDate(at)}, {formatTime(at)}
                {entry.status !== 'confirmed' && ` · ${STATUS_LABEL[entry.status]}`}
              </span>
            </span>
          </span>
          <span className={earning ? styles.amountIn : styles.amountOut}>
            {earning ? '+' : '−'}
            {formatNaira(Math.abs(entry.amount.kobo))}
          </span>
        </summary>
        <dl className={styles.stack} style={{ margin: 'var(--space-12) 0 0 3rem' }}>
          <DetailRow term="Status" value={STATUS_LABEL[entry.status] ?? entry.status} />
          <DetailRow term="Date" value={formatFullDate(at)} />
          {earning && <DetailRow term="Topic" value={categoryLabel(entry.category)} />}
          {earning && entry.paidFromTreasury && (
            <DetailRow term="Paid by" value="CareLayer (her free answer)" />
          )}
          <DetailRow term="Amount" value={`${entry.amount.usdc.replace('-', '')} USDC`} />
          {!earning && <DetailRow term="To" value={shortAddress(entry.destinationAddress)} />}
          {!earning && entry.destinationMemo && (
            <DetailRow term="Memo" value={entry.destinationMemo.value} />
          )}
          {entry.stellarTxHash && (
            <a
              className={styles.link}
              href={stellarExplorerUrl('tx', entry.stellarTxHash)}
              target="_blank"
              rel="noreferrer"
            >
              View on Stellar
            </a>
          )}
        </dl>
      </details>
    </li>
  );
}

function DetailRow({ term, value }: { term: string; value: string }) {
  return (
    <div className={styles.row}>
      <dt className={cx(styles.bodySmall, styles.muted)}>{term}</dt>
      <dd className={styles.bodySmall} style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
