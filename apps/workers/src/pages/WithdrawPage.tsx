import {
  MIN_WITHDRAWAL_KOBO,
  stellarExplorerUrl,
  type CreateWithdrawalBody,
  type EarningsResponse,
  type Withdrawal,
  type WithdrawalMemo,
} from '@carelayer/shared';
import { isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { BackLink } from '@web/components/BackLink/BackLink';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { Chip } from '@web/components/Chip/Chip';
import { cx } from '@web/components/cx';
import { Input } from '@web/components/Input/Input';
import { formatNaira } from '@web/utils/money';
import { useState, type FormEvent } from 'react';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { paths } from '../routes/paths';
import { LoadError, Skeleton } from '../workspace/components';
import { withdrawErrorMessage } from '../workspace/errors';
import { parseNaira, shortAddress } from '../workspace/format';
import { useNurseQuery } from '../workspace/hooks';
import { StepUp } from '../workspace/StepUp';
import styles from '../workspace/workspace.module.css';

/*
 * Withdraw (no frame; N09's "Withdraw"). POST /nurse/withdrawals after a fresh code.
 * Stellar address only; bank withdrawal is "Coming soon" (contract §12, no endpoint).
 * Rules shown before sending: ₦100 minimum, at most what is available, one at a time,
 * and a memo only if the receiving wallet (usually an exchange) asks for one.
 */

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export function WithdrawPage() {
  const earnings = useNurseQuery((api) => api.earnings.get());
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <BackLink to={paths.earnings} label="Back to earnings" />
      </div>
      <h1 className={styles.titleSmall}>Withdraw</h1>
      {earnings.status === 'loading' && <Skeleton count={2} height="8rem" />}
      {earnings.status === 'error' && (
        <LoadError
          error={earnings.error}
          fallback="We could not load your balance."
          onRetry={earnings.reload}
        />
      )}
      {earnings.data && <WithdrawFlow earnings={earnings.data} />}
    </div>
  );
}

type Errors = Partial<Record<'amount' | 'address' | 'memo', string>>;

function WithdrawFlow({ earnings }: { earnings: EarningsResponse }) {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState(earnings.payoutAddress ?? '');
  const [memoType, setMemoType] = useState<'none' | WithdrawalMemo['type']>('none');
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [freshUntil, setFreshUntil] = useState<number>(0);
  const [pending, setPending] = useState<CreateWithdrawalBody | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Withdrawal | null>(null);

  const available = earnings.available.kobo;

  const validate = (): CreateWithdrawalBody | null => {
    const next: Errors = {};
    const kobo = parseNaira(amount);
    if (kobo === null) next.amount = 'Enter an amount in naira, like 5,000.';
    else if (kobo < MIN_WITHDRAWAL_KOBO)
      next.amount = `The smallest withdrawal is ${formatNaira(MIN_WITHDRAWAL_KOBO)}.`;
    else if (kobo > available)
      next.amount = `You have ${formatNaira(available)} available to withdraw.`;
    const to = address.trim();
    if (!STELLAR_ADDRESS.test(to)) {
      next.address = 'Enter a Stellar address: 56 characters starting with G.';
    } else if (to === earnings.stellarAddress) {
      next.address = 'That is your CareLayer wallet. Enter the wallet you want to send to.';
    }
    let memoValue: WithdrawalMemo | undefined;
    if (memoType !== 'none') {
      const v = memo.trim();
      if (memoType === 'id' && !/^\d{1,20}$/.test(v)) next.memo = 'A memo ID is a number.';
      if (memoType === 'text' && (!v || new TextEncoder().encode(v).length > 28)) {
        next.memo = 'A text memo is 1 to 28 characters.';
      }
      memoValue = { type: memoType, value: v };
    }
    setErrors(next);
    if (Object.keys(next).length) return null;
    return {
      amountKobo: kobo!,
      destination: { kind: 'stellar', address: to, ...(memoValue && { memo: memoValue }) },
    };
  };

  const send = async (body: CreateWithdrawalBody) => {
    setSending(true);
    setFormError(undefined);
    try {
      setResult(await api.earnings.withdraw(body));
    } catch (e) {
      if (isSessionError(e)) sessionExpired();
      if (isApiError(e) && e.code === 'STEP_UP_REQUIRED') {
        // Her 5 minutes ran out: confirm again, then it sends.
        setPending(body);
        setNeedsCode(true);
      } else {
        if (isApiError(e) && e.details?.field === 'destination.address') {
          setErrors({ address: e.message });
        } else if (isApiError(e) && e.details?.field === 'destination.memo') {
          setErrors({ memo: e.message });
        } else {
          setFormError(withdrawErrorMessage(e));
        }
      }
    } finally {
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const body = validate();
    if (!body) return;
    if (freshUntil <= Date.now()) {
      setPending(body);
      setNeedsCode(true);
      return;
    }
    void send(body);
  };

  if (result) return <WithdrawResult withdrawal={result} />;

  if (needsCode && pending) {
    return (
      <>
        <section className={styles.card} aria-label="Withdrawal summary">
          <div className={styles.row}>
            <span className={styles.muted}>Amount</span>
            <span className={styles.label}>{formatNaira(pending.amountKobo)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.muted}>To</span>
            <span className={styles.address}>{shortAddress(pending.destination.address)}</span>
          </div>
        </section>
        <StepUp
          reason="Before you withdraw"
          onConfirmed={(until) => {
            setFreshUntil(Date.parse(until));
            setNeedsCode(false);
            void send(pending);
          }}
        />
        <Button variant="ghost" onClick={() => setNeedsCode(false)}>
          Change details
        </Button>
      </>
    );
  }

  return (
    <form className={styles.page} onSubmit={submit} noValidate>
      <section className={styles.primaryCard} aria-label="Available to withdraw">
        <span className={styles.muted}>Available to withdraw</span>
        <span className={styles.titleSmall} style={{ color: 'inherit' }}>
          {formatNaira(available)}
        </span>
      </section>

      <fieldset className={styles.stack} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.fieldLabel}>Send to</legend>
        <div className={styles.chips}>
          <Chip selected>Stellar wallet</Chip>
          <Chip disabled aria-describedby="bank-soon">
            Bank account
          </Chip>
        </div>
        <span id="bank-soon" className={cx(styles.caption, styles.muted)}>
          Bank withdrawals are coming soon.
        </span>
      </fieldset>

      <Input
        label="Amount in naira"
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={errors.amount}
        hint={`At least ${formatNaira(MIN_WITHDRAWAL_KOBO)}.`}
      />
      <Button
        type="button"
        variant="ghost"
        onClick={() => setAmount(String(available / 100))}
        disabled={available < MIN_WITHDRAWAL_KOBO}
      >
        Withdraw everything ({formatNaira(available)})
      </Button>

      <Input
        label="Stellar wallet address"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={address}
        onChange={(e) => setAddress(e.target.value.trim())}
        error={errors.address}
        hint="56 characters, starting with G. The wallet must accept USDC."
      />

      <fieldset className={styles.stack} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.fieldLabel}>Memo</legend>
        <div className={styles.chips}>
          <Chip selected={memoType === 'none'} onClick={() => setMemoType('none')}>
            No memo
          </Chip>
          <Chip selected={memoType === 'id'} onClick={() => setMemoType('id')}>
            Memo ID
          </Chip>
          <Chip selected={memoType === 'text'} onClick={() => setMemoType('text')}>
            Text memo
          </Chip>
        </div>
        <span className={cx(styles.caption, styles.muted)}>
          Only if the receiving wallet asks for one. Exchanges usually do; without it the money can
          be lost. A personal wallet needs no memo.
        </span>
      </fieldset>
      {memoType !== 'none' && (
        <Input
          label={memoType === 'id' ? 'Memo ID' : 'Text memo'}
          inputMode={memoType === 'id' ? 'numeric' : 'text'}
          autoComplete="off"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          error={errors.memo}
        />
      )}

      {formError && <Alert tone="error">{formError}</Alert>}
      <Button type="submit" disabled={sending} fullWidth>
        {sending ? 'Sending…' : 'Continue'}
      </Button>
      <p className={cx(styles.caption, styles.muted)}>
        One withdrawal at a time. CareLayer pays the network fee.
      </p>
    </form>
  );
}

function WithdrawResult({ withdrawal }: { withdrawal: Withdrawal }) {
  const done = withdrawal.status === 'confirmed';
  return (
    <section className={styles.page} aria-live="polite">
      <Alert tone="success">
        {done
          ? `${formatNaira(withdrawal.amount)} is on its way and confirmed on Stellar.`
          : `${formatNaira(withdrawal.amount)} was sent. Stellar is confirming it; this usually takes under 3 minutes. It is never sent twice.`}
      </Alert>
      <div className={styles.card}>
        <div className={styles.row}>
          <span className={styles.muted}>Status</span>
          <span className={styles.label}>{done ? 'Confirmed' : 'Processing'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>To</span>
          <span className={styles.address}>{shortAddress(withdrawal.destinationAddress)}</span>
        </div>
        {withdrawal.stellarTxHash && (
          <a
            className={styles.link}
            href={stellarExplorerUrl('tx', withdrawal.stellarTxHash)}
            target="_blank"
            rel="noreferrer"
          >
            View on Stellar
          </a>
        )}
      </div>
      <ButtonLink to={paths.withdrawals} variant="secondary">
        See withdrawal history
      </ButtonLink>
      <ButtonLink to={paths.earnings}>Back to earnings</ButtonLink>
    </section>
  );
}
