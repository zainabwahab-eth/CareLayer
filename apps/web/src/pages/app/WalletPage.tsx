import {
  FREE_ANSWERS_PER_WOMAN,
  stellarExplorerUrl,
  type WalletResponse,
  type WalletTransaction,
} from '@carelayer/shared';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { loadErrorMessage } from '../../api/error-message';
import { useApiQuery } from '../../api/useApiQuery';
import { usePagedQuery, type PagedQueryResult } from '../../api/usePagedQuery';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { Alert } from '../../components/Alert/Alert';
import { Button } from '../../components/Button/Button';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { TopBar } from '../../components/navigation/TopBar';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { useAppShell } from '../../layouts/app-shell';
import { consultationPath, paths } from '../../routes/paths';
import { formatFullDate, formatListDate, formatTime } from '../../utils/dates';
import { formatNaira } from '../../utils/money';
import { TopUpDialog } from './wallet/TopUpDialog';
import { useTopupReturn, type TopupReturnState } from './wallet/useTopupReturn';
import styles from './WalletPage.module.css';

/** Balance older than this was not read live (Stellar did not answer in time). */
const STALE_BALANCE_MS = 60_000;

const TX_LABELS: Record<WalletTransaction['kind'], string> = {
  topup: 'Top-up',
  answer_payment: 'Answer from a nurse',
  // Nurse-only kinds; listed for completeness.
  answer_earning: 'Earning',
  withdrawal: 'Withdrawal',
};

/**
 * Women wallet (no Figma frame; docs/TASKS.md §3 "Women wallet").
 * Balance card like the nurse earnings card, Top up only (women cannot
 * withdraw), free answers left, spending limit per answer, and activity with
 * "View on Stellar" links. Data: GET /wallet, GET /wallet/transactions,
 * GET /me/settings, POST /topups, GET /topups/:id (contract §3-5).
 */
export function WalletPage() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { refreshWallet } = useAppShell();
  // Remember when it arrived, to tell whether balanceSyncedAt is a live read.
  const wallet = useApiQuery(async (api) => {
    const data = await api.wallet.get();
    return { ...data, receivedAt: Date.now() };
  });
  const settings = useApiQuery((api) => api.me.getSettings());
  const activity = usePagedQuery((api, cursor) => api.wallet.listTransactions({ cursor }));
  useSessionGuard(wallet.error, settings.error, activity.error, activity.loadMoreError);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const reloadWallet = wallet.reload;
  const reloadActivity = activity.reload;
  const onCredited = useCallback(() => {
    reloadWallet();
    reloadActivity();
    refreshWallet();
  }, [reloadWallet, reloadActivity, refreshWallet]);
  const topupReturn = useTopupReturn(onCredited);

  return (
    <div className={styles.page}>
      {isDesktop ? (
        <PageHeader
          title="Wallet"
          subtitle="Your balance, top-ups and what you paid for answers."
        />
      ) : (
        <TopBar title="Wallet" backTo={paths.account} backLabel="Back to account" />
      )}

      <TopupBanner
        state={topupReturn.state}
        onCheckAgain={topupReturn.checkAgain}
        onTryAgain={() => {
          topupReturn.dismiss();
          setTopUpOpen(true);
        }}
      />

      <div className={styles.columns}>
        <div className={styles.main}>
          {wallet.status === 'loading' && (
            <p className={styles.message} role="status">
              Loading your balance…
            </p>
          )}
          {wallet.status === 'error' && (
            <div className={styles.errorBlock}>
              <Alert tone="error">
                {loadErrorMessage(wallet.error, 'We could not load your balance.')}
              </Alert>
              <Button variant="secondary" onClick={wallet.reload}>
                Try again
              </Button>
            </div>
          )}
          {wallet.data && <BalanceCard wallet={wallet.data} onTopUp={() => setTopUpOpen(true)} />}

          <Activity activity={activity} />
        </div>

        <aside className={styles.side} aria-label="Wallet details">
          <section className={styles.card} aria-labelledby="wallet-details-title">
            <h2 id="wallet-details-title" className={styles.cardTitle}>
              Payments
            </h2>
            <dl className={styles.details}>
              <div className={styles.detail}>
                <dt>Free answers left</dt>
                <dd>
                  {wallet.data?.freeAnswersRemaining != null
                    ? `${wallet.data.freeAnswersRemaining} of ${FREE_ANSWERS_PER_WOMAN}`
                    : '–'}
                </dd>
              </div>
              <div className={styles.detail}>
                <dt>Spending limit per answer</dt>
                <dd>
                  {settings.status === 'success'
                    ? formatLimit(settings.data.spendingLimitPerAnswerKobo)
                    : settings.status === 'error'
                      ? 'Not available right now'
                      : '…'}
                </dd>
              </div>
            </dl>
            <p className={styles.small}>
              After your free answers, you pay for an answer only when you open it. Anything above
              your limit asks you first.{' '}
              <Link to={paths.account} className={styles.link}>
                Change your limit
              </Link>
            </p>
          </section>

          {wallet.data && <WalletAddress wallet={wallet.data} />}
        </aside>
      </div>

      <TopUpDialog open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </div>
  );
}

function formatLimit(kobo: number) {
  return kobo === 0 ? 'Always ask me' : formatNaira(kobo);
}

/** Like the nurse earnings card: primary panel, balance in naira, Top up only. */
function BalanceCard({
  wallet,
  onTopUp,
}: {
  wallet: WalletResponse & { receivedAt: number };
  onTopUp: () => void;
}) {
  const synced = wallet.balanceSyncedAt ? Date.parse(wallet.balanceSyncedAt) : null;
  const stale = synced === null || wallet.receivedAt - synced > STALE_BALANCE_MS;
  return (
    <section className={styles.balance} aria-labelledby="balance-title">
      <h2 id="balance-title" className={styles.balanceLabel}>
        Balance
      </h2>
      <p className={styles.balanceAmount}>{formatNaira(wallet.balance)}</p>
      <p className={styles.balanceNote}>Held as USDC in your own wallet</p>
      {wallet.status === 'pending' && (
        <p className={styles.balanceNote}>
          Your wallet is still being set up on Stellar. You can top up now; it finishes first.
        </p>
      )}
      {wallet.status === 'active' && stale && (
        <p className={styles.balanceNote}>
          {synced === null
            ? 'Balance not checked yet. Check again in a moment.'
            : `Last checked at ${formatTime(wallet.balanceSyncedAt!)}. Stellar is slow to respond right now.`}
        </p>
      )}
      <Button tone="inverse" variant="secondary" onClick={onTopUp} className={styles.topUp}>
        Top up
      </Button>
    </section>
  );
}

function WalletAddress({ wallet }: { wallet: WalletResponse }) {
  const address = wallet.stellarAddress;
  const short = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
  return (
    <section className={styles.card} aria-labelledby="wallet-address-title">
      <h2 id="wallet-address-title" className={styles.cardTitle}>
        Your wallet
      </h2>
      <p className={styles.small}>
        CareLayer holds it for you on the Stellar test network. You never need keys.
      </p>
      <p className={styles.address}>
        <span className="visually-hidden">Address: </span>
        <span title={address}>{short}</span>
      </p>
      <a
        href={stellarExplorerUrl('account', address)}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
      >
        View on Stellar<span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </section>
  );
}

function Activity({ activity }: { activity: PagedQueryResult<WalletTransaction> }) {
  return (
    <section className={styles.activity} aria-labelledby="activity-title">
      <h2 id="activity-title" className={styles.sectionTitle}>
        Activity
      </h2>
      {activity.status === 'loading' && (
        <p className={styles.message} role="status">
          Loading activity…
        </p>
      )}
      {activity.status === 'error' && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {loadErrorMessage(activity.error, 'We could not load your activity.')}
          </Alert>
          <Button variant="secondary" onClick={activity.reload}>
            Try again
          </Button>
        </div>
      )}
      {activity.status === 'success' && activity.items.length === 0 && (
        <p className={styles.message}>
          No activity yet. Top-ups and paid answers will appear here. Free answers are not listed.
        </p>
      )}
      {activity.items.length > 0 && (
        <ul role="list" className={styles.txList}>
          {activity.items.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </ul>
      )}
      {activity.loadMoreError && (
        <Alert tone="error">
          {loadErrorMessage(activity.loadMoreError, 'We could not load more activity.')}
        </Alert>
      )}
      {activity.hasMore && (
        <Button
          variant="secondary"
          onClick={activity.loadMore}
          disabled={activity.loadingMore}
          aria-busy={activity.loadingMore || undefined}
          className={styles.more}
        >
          {activity.loadingMore ? 'Loading…' : 'Show older activity'}
        </Button>
      )}
    </section>
  );
}

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const incoming = tx.amount.kobo >= 0;
  const amount = `${incoming ? '+' : '−'}${formatNaira(Math.abs(tx.amount.kobo))}`;
  return (
    <li className={styles.tx}>
      <div className={styles.txMain}>
        <span className={styles.txLabel}>
          {tx.questionId ? (
            <Link to={consultationPath(tx.questionId)} className={styles.txLabelLink}>
              {TX_LABELS[tx.kind]}
            </Link>
          ) : (
            TX_LABELS[tx.kind]
          )}
        </span>
        <span className={styles.txMeta}>
          <time dateTime={tx.createdAt} title={formatFullDate(tx.createdAt)}>
            {formatListDate(tx.createdAt, { weekday: true })}
          </time>
          {tx.stellarTxHash && (
            <>
              {' · '}
              <a
                href={stellarExplorerUrl('tx', tx.stellarTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                View on Stellar
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </>
          )}
        </span>
      </div>
      <span className={incoming ? styles.amountIn : styles.amountOut}>
        <span className="visually-hidden">{incoming ? 'Added ' : 'Paid '}</span>
        {amount}
      </span>
    </li>
  );
}

function TopupBanner({
  state,
  onCheckAgain,
  onTryAgain,
}: {
  state: TopupReturnState;
  onCheckAgain: () => void;
  onTryAgain: () => void;
}) {
  switch (state.phase) {
    case 'none':
      return null;
    case 'checking':
      return <Alert tone="info">Checking your top-up…</Alert>;
    case 'pending':
      return (
        <Alert tone="info">
          Waiting for Paystack to confirm your payment of {formatNaira(state.topup.amount)}. If you
          closed the Paystack page without paying, no money was taken.
        </Alert>
      );
    case 'paid':
      return (
        <Alert tone="info">
          Payment received. Adding {formatNaira(state.topup.amount)} to your wallet…
        </Alert>
      );
    case 'credited':
      return (
        <Alert tone="success">
          {formatNaira(state.topup.amount)} added to your wallet.
          {state.topup.stellarTxHash && (
            <>
              {' '}
              <a
                href={stellarExplorerUrl('tx', state.topup.stellarTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
              >
                View on Stellar<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </>
          )}
        </Alert>
      );
    case 'failed':
      return (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            Your top-up of {formatNaira(state.topup.amount)} did not go through, so nothing was
            added to your wallet.
          </Alert>
          <Button variant="secondary" onClick={onTryAgain}>
            Try again
          </Button>
        </div>
      );
    case 'slow':
      return (
        <div className={styles.errorBlock}>
          <Alert tone="info">
            This is taking longer than usual.{' '}
            {state.topup?.status === 'paid'
              ? 'Paystack has confirmed your payment; the money will reach your wallet soon.'
              : 'If you paid, your balance updates as soon as Paystack confirms it.'}
          </Alert>
          <Button variant="secondary" onClick={onCheckAgain}>
            Check again
          </Button>
        </div>
      );
    case 'error':
      return (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {loadErrorMessage(state.error, 'We could not check your top-up.')}
          </Alert>
          <Button variant="secondary" onClick={onCheckAgain}>
            Check again
          </Button>
        </div>
      );
  }
}
