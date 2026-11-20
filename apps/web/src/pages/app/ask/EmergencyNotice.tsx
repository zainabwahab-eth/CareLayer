import type { EmergencyResponse } from '@carelayer/shared';
import { useId } from 'react';
import { ButtonLink } from '../../../components/Button/Button';
import { Icon } from '../../../components/Icon/Icon';
import type { EmergencyLocationState } from '../../../chat/emergency-state';
import { paths } from '../../../routes/paths';
import styles from './EmergencyNotice.module.css';

/*
 * In-thread marker after a message that matched a red flag. The chat has
 * already opened W13; this lets her get back to it. No nurse offer, no
 * payment, nothing queued (contract §6).
 */
export function EmergencyNotice({ response }: { response: EmergencyResponse }) {
  const titleId = useId();
  const state: EmergencyLocationState = { emergency: response };

  return (
    <li>
      <section className={styles.notice} aria-labelledby={titleId}>
        <div className={styles.head}>
          <Icon name="alert" size={20} />
          <h2 id={titleId} className={styles.title}>
            This may be an emergency
          </h2>
        </div>
        <p className={styles.message}>{response.message}</p>
        <ButtonLink to={paths.emergency} state={state} variant="emergency" fullWidth>
          Get urgent help now
        </ButtonLink>
        <p className={styles.note}>Nothing was sent to anyone and you were not charged.</p>
      </section>
    </li>
  );
}
