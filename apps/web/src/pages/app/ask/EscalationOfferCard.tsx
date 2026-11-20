import {
  FREE_ANSWERS_PER_WOMAN,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  type EscalationOffer,
} from '@carelayer/shared';
import { useId } from 'react';
import { Badge } from '../../../components/Badge/Badge';
import { Button, ButtonLink } from '../../../components/Button/Button';
import { Icon } from '../../../components/Icon/Icon';
import { paths } from '../../../routes/paths';
import { categoryLabel } from '../../../utils/categories';
import { formatNaira } from '../../../utils/money';
import styles from './EscalationOfferCard.module.css';

/*
 * Figma W06 / D-W06 "Escalation suggestion". The assistant thinks a verified
 * professional should look. Nothing is sent until she reviews and consents
 * (W07), and nothing is charged until an answer is ready (pay on delivery).
 */
export interface EscalationOfferCardProps {
  offer: EscalationOffer;
  onDismiss: () => void;
}

export function EscalationOfferCard({ offer, onDismiss }: EscalationOfferCardProps) {
  const titleId = useId();
  const plural = offer.freeAnswersRemaining === 1 ? 'answer' : 'answers';

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <span className={styles.iconCircle} aria-hidden>
        <Icon name="shield" size={24} />
      </span>

      <div className={styles.text}>
        <div className={styles.head}>
          <Icon name="shield" size={22} className={styles.headIcon} />
          <h2 id={titleId} className={styles.title}>
            A nurse or midwife should check this
          </h2>
        </div>
        <p className={styles.body}>
          A verified professional can look at your question. You decide whether to send it.
        </p>
        <div className={styles.meta}>
          <Badge variant="neutral">
            <span className="visually-hidden">Category: </span>
            {categoryLabel(offer.suggestedCategory)}
          </Badge>
          <p className={styles.price}>
            {offer.isFree ? (
              <>
                <strong>Free.</strong> {offer.freeAnswersRemaining} of {FREE_ANSWERS_PER_WOMAN} free{' '}
                {plural} left.
              </>
            ) : (
              <>
                <strong>{formatNaira(offer.price)}</strong>, charged only when a nurse answers. If
                no nurse picks it up within {QUESTION_CLAIMS_CLOSE_MINUTES} minutes, you pay
                nothing.
              </>
            )}
          </p>
        </div>
        {offer.exceedsSpendingLimit && (
          <p className={styles.limit}>
            This is above your spending limit per answer, so we will ask you to approve it before
            sending.
          </p>
        )}
      </div>

      <div className={styles.actions}>
        <ButtonLink to={paths.askConsent} className={styles.primary}>
          Review and send
        </ButtonLink>
        <Button variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
