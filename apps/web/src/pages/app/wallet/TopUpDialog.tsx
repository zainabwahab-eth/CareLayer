import { TOPUP_LIMITS_KOBO } from '@carelayer/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { isApiError } from '../../../api/errors';
import { useApi } from '../../../api/useApi';
import { useSessionGuard } from '../../../auth/useSessionGuard';
import { Alert } from '../../../components/Alert/Alert';
import { Button } from '../../../components/Button/Button';
import { Chip } from '../../../components/Chip/Chip';
import { Input } from '../../../components/Input/Input';
import { formatNaira } from '../../../utils/money';
import styles from './TopUpDialog.module.css';

/*
 * Top up (docs/TASKS.md §3 "Women wallet"): a bottom sheet on mobile, a modal
 * on desktop. ₦1,000 / ₦2,000 / ₦5,000 / Other, then Paystack (test mode).
 * POST /topups returns the Paystack checkout URL; she leaves the app to pay and
 * Paystack sends her back to the wallet screen (see useTopupReturn).
 */
const PRESETS_KOBO = [100_000, 200_000, 500_000] as const;
type Choice = (typeof PRESETS_KOBO)[number] | 'other';

const MIN_NAIRA = TOPUP_LIMITS_KOBO.min / 100;
const MAX_NAIRA = TOPUP_LIMITS_KOBO.max / 100;

export interface TopUpDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Whole naira between the limits, else an error message. */
function parseOtherAmount(raw: string): { kobo: number } | { error: string } {
  const cleaned = raw.replace(/[₦,\s]/g, '');
  const limits = `Enter an amount from ${formatNaira(TOPUP_LIMITS_KOBO.min)} to ${formatNaira(TOPUP_LIMITS_KOBO.max)}.`;
  if (!cleaned) return { error: limits };
  if (!/^\d+$/.test(cleaned)) return { error: 'Use whole naira, numbers only.' };
  const naira = Number(cleaned);
  if (naira < MIN_NAIRA || naira > MAX_NAIRA) return { error: limits };
  return { kobo: naira * 100 };
}

/**
 * Only ever leave the app for an https checkout page (or this app itself, which
 * is what the mock API returns). Anything else is refused.
 */
function isSafeCheckoutUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function TopUpDialog({ open, onClose }: TopUpDialogProps) {
  const api = useApi();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [choice, setChoice] = useState<Choice>(PRESETS_KOBO[0]);
  const [other, setOther] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [sessionError, setSessionError] = useState<unknown>();
  useSessionGuard(sessionError);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFormError(undefined);
      setFieldError(undefined);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const otherSelected = choice === 'other';
  const parsedOther = otherSelected ? parseOtherAmount(other) : null;
  const amountKobo =
    choice === 'other' ? (parsedOther && 'kobo' in parsedOther ? parsedOther.kobo : null) : choice;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(undefined);
    if (parsedOther && 'error' in parsedOther) {
      setFieldError(parsedOther.error);
      return;
    }
    if (amountKobo === null) return;
    setSubmitting(true);
    try {
      const { authorizationUrl } = await api.topups.create({ amountKobo });
      if (!isSafeCheckoutUrl(authorizationUrl)) {
        throw new Error('Unexpected checkout URL');
      }
      // Full-page redirect (contract §5). Keep the busy state while the browser leaves.
      window.location.assign(authorizationUrl);
    } catch (error) {
      setSubmitting(false);
      setSessionError(error);
      if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
        if (otherSelected) setFieldError(error.message);
        else setFormError(error.message);
      } else if (isApiError(error) && error.code === 'SERVICE_UNAVAILABLE') {
        setFormError('Top-ups are not available right now. Please try again later.');
      } else if (isApiError(error) && error.status === 0) {
        setFormError('Could not reach CareLayer. Check your connection and try again.');
      } else {
        setFormError('We could not start your top-up. Please try again.');
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      // Esc or the browser's own close: keep React state in step.
      onClose={onClose}
      onClick={(event) => {
        // Tap on the backdrop closes it (the dialog element itself is the backdrop area).
        if (event.target === dialogRef.current && !submitting) onClose();
      }}
    >
      <form className={styles.sheet} onSubmit={handleSubmit} noValidate>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Top up
          </h2>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className={styles.close}
          >
            Close
          </Button>
        </div>

        <fieldset className={styles.amounts}>
          <legend className={styles.legend}>How much?</legend>
          <div className={styles.chips}>
            {PRESETS_KOBO.map((kobo) => (
              <Chip
                key={kobo}
                selected={choice === kobo}
                onClick={() => {
                  setChoice(kobo);
                  setFieldError(undefined);
                }}
              >
                {formatNaira(kobo)}
              </Chip>
            ))}
            <Chip selected={otherSelected} onClick={() => setChoice('other')}>
              Other
            </Chip>
          </div>
        </fieldset>

        {otherSelected && (
          <Input
            label="Amount in naira"
            inputMode="numeric"
            autoComplete="off"
            value={other}
            onChange={(event) => {
              setOther(event.target.value);
              setFieldError(undefined);
            }}
            hint={`${formatNaira(TOPUP_LIMITS_KOBO.min)} to ${formatNaira(TOPUP_LIMITS_KOBO.max)}`}
            error={fieldError}
            // Moves focus to the new field when she picks "Other".
            autoFocus
          />
        )}

        <p className={styles.note}>
          You pay on Paystack (test mode: no real money). The same amount is then added to your
          wallet as USDC.
        </p>

        {formError && <Alert tone="error">{formError}</Alert>}

        <Button type="submit" fullWidth disabled={submitting} aria-busy={submitting || undefined}>
          {submitting
            ? 'Opening Paystack…'
            : amountKobo !== null
              ? `Top up ${formatNaira(amountKobo)}`
              : 'Continue to Paystack'}
        </Button>
      </form>
    </dialog>
  );
}
