import { stellarExplorerUrl, type WalletTransaction, type Withdrawal } from '@carelayer/shared';
import { Alert } from '@web/components/Alert/Alert';
import { BackLink } from '@web/components/BackLink/BackLink';
import { Button } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { formatFullDate, formatListDate, formatTime } from '@web/utils/dates';
import { formatNaira } from '@web/utils/money';
import { useState } from 'react';
import { paths } from '../routes/paths';
import { EmptyState, LoadError, Skeleton } from '../workspace/components';
import { shortAddress } from '../workspace/format';
import { useNursePaged, type PagedResult } from '../workspace/hooks';
import styles from '../workspace/workspace.module.css';

/*
 * Payment history (no frame; N09's "See all").
 *   Withdrawals:   GET /nurse/withdrawals (every status, including failed ones and why)
 *   All payments:  GET /wallet/transactions (confirmed money in and out)
 */
type View = 'withdrawals' | 'transactions';

export function WithdrawalsPage() {
  const [view, setView] = useState<View>('transactions');
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <BackLink to={paths.earnings} label="Back to earnings" />
      </div>
      <h1 className={styles.titleSmall}>Payment history</h1>
      <div className={styles.segments} role="tablist" aria-label="History">
        {(
          [
            ['transactions', 'All payments'],
            ['withdrawals', 'Withdrawals'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={cx(styles.segment, view === key && styles.segmentActive)}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'transactions' ? <TransactionList /> : <WithdrawalList />}
    </div>
  );
}

function MoreButton<T>({ list }: { list: PagedResult<T> }) {
  return (
    <>
      {list.loadMoreError && <Alert tone="error">We could not load more. Try again.</Alert>}
      {list.hasMore && (
        <Button variant="secondary" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </>
  );
}

function TransactionList() {
  const list = useNursePaged((api, cursor) => api.earnings.listTransactions({ cursor }));
  if (list.status === 'loading') return <Skeleton count={3} height="4rem" />;
  if (list.status === 'error') {
    return (
      <LoadError
        error={list.error}
        fallback="We could not load your payments."
        onRetry={list.reload}
      />
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState icon="wallet" title="No payments yet">
        Confirmed earnings and withdrawals appear here.
      </EmptyState>
    );
  }
  return (
    <>
      <div className={styles.card}>
        <ul role="list" className={styles.list}>
          {list.items.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </ul>
      </div>
      <MoreButton list={list} />
    </>
  );
}

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const incoming = tx.amount.kobo >= 0;
  return (
    <li className={styles.listItem}>
      <span className={styles.rowStart}>
        <span className={styles.listIcon} aria-hidden>
          <Icon name={incoming ? 'heart' : 'send'} size={18} />
        </span>
        <span className={styles.stack}>
          <span className={styles.label}>{incoming ? 'Answer payment' : 'Withdrawal'}</span>
          <span className={cx(styles.caption, styles.muted)}>
            <time dateTime={tx.createdAt} title={formatFullDate(tx.createdAt)}>
              {formatListDate(tx.createdAt)}, {formatTime(tx.createdAt)}
            </time>
            {tx.stellarTxHash && (
              <>
                {' · '}
                <a
                  className={styles.link}
                  href={stellarExplorerUrl('tx', tx.stellarTxHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Stellar
                </a>
              </>
            )}
          </span>
        </span>
      </span>
      <span className={incoming ? styles.amountIn : styles.amountOut}>
        {incoming ? '+' : '−'}
        {formatNaira(Math.abs(tx.amount.kobo))}
      </span>
    </li>
  );
}

const WITHDRAWAL_STATUS: Record<Withdrawal['status'], string> = {
  pending: 'Starting',
  submitted: 'Processing',
  confirmed: 'Confirmed',
  failed: 'Failed',
};

function WithdrawalList() {
  const list = useNursePaged((api, cursor) => api.earnings.listWithdrawals({ cursor }));
  if (list.status === 'loading') return <Skeleton count={3} height="5rem" />;
  if (list.status === 'error') {
    return (
      <LoadError
        error={list.error}
        fallback="We could not load your withdrawals."
        onRetry={list.reload}
      />
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState icon="send" title="No withdrawals yet">
        Money you send to your own Stellar wallet appears here.
      </EmptyState>
    );
  }
  const processing = list.items.some((w) => w.status === 'pending' || w.status === 'submitted');
  return (
    <>
      {processing && (
        <div className={styles.row}>
          <span className={cx(styles.bodySmall, styles.muted)}>
            A withdrawal is processing. It settles within about 3 minutes.
          </span>
          <Button variant="secondary" onClick={list.reload}>
            Refresh
          </Button>
        </div>
      )}
      <div className={styles.card}>
        <ul role="list" className={styles.list}>
          {list.items.map((w) => (
            <li key={w.id} className={styles.listItem} style={{ alignItems: 'flex-start' }}>
              <span className={styles.stack}>
                <span className={styles.label}>
                  To {shortAddress(w.destinationAddress)}
                  {w.destinationMemo && ` · memo ${w.destinationMemo.value}`}
                </span>
                <span className={cx(styles.caption, styles.muted)}>
                  {formatListDate(w.createdAt)}, {formatTime(w.createdAt)} ·{' '}
                  {WITHDRAWAL_STATUS[w.status]}
                </span>
                {w.status === 'failed' && (
                  <span className={styles.bodySmall}>
                    Nothing left your wallet.{w.failureReason ? ` ${w.failureReason}` : ''}
                  </span>
                )}
                {w.stellarTxHash && (
                  <a
                    className={styles.link}
                    href={stellarExplorerUrl('tx', w.stellarTxHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Stellar
                  </a>
                )}
              </span>
              <span className={w.status === 'failed' ? styles.muted : styles.amountOut}>
                −{formatNaira(Math.abs(w.amount.kobo))}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <MoreButton list={list} />
    </>
  );
}
