import { FREE_ANSWERS_PER_WOMAN } from '@carelayer/shared';
import { useId } from 'react';
import { Link } from 'react-router';
import { useApiQuery } from '../../../api/useApiQuery';
import { cx } from '../../../components/cx';
import { Icon } from '../../../components/Icon/Icon';
import type { IconName } from '../../../components/Icon/icons';
import { paths } from '../../../routes/paths';
import styles from './ChatContextRail.module.css';

/*
 * Figma D-W06 "Context rail" (desktop only): what this chat is, free nurse
 * answers left (GET /wallet), and a way to urgent help.
 */
const POINTS: ReadonlyArray<{ icon: IconName; iconSize: number; title: string; body: string }> = [
  {
    icon: 'sparkle',
    iconSize: 20,
    title: 'AI guidance',
    body: 'Your assistant explains and suggests. It doesn’t diagnose or prescribe.',
  },
  {
    icon: 'shield',
    iconSize: 20,
    title: 'Nurses when needed',
    body: 'Verified nurses and midwives review anything that needs a professional.',
  },
  {
    icon: 'lock',
    iconSize: 20,
    title: 'Private',
    body: 'Nothing is shared without your consent.',
  },
];

export function ChatContextRail({ className }: { className?: string }) {
  const wallet = useApiQuery((api) => api.wallet.get());
  const freeLeft = wallet.data?.freeAnswersRemaining;
  const titleId = useId();

  return (
    <aside className={cx(styles.rail, className)} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        About this chat
      </h2>
      <ul className={styles.points} role="list">
        {POINTS.map((point) => (
          <li key={point.title} className={styles.point}>
            <Icon name={point.icon} size={point.iconSize} className={styles.pointIcon} />
            <div>
              <p className={styles.pointTitle}>{point.title}</p>
              <p className={styles.pointBody}>{point.body}</p>
            </div>
          </li>
        ))}
      </ul>

      {typeof freeLeft === 'number' && (
        <div className={styles.free}>
          <p className={styles.freeLabel}>Free nurse answers</p>
          <p className={styles.freeValue}>
            {freeLeft} of {FREE_ANSWERS_PER_WOMAN} left
          </p>
        </div>
      )}

      <div className={styles.spacer} />

      <Link to={paths.emergency} className={styles.urgent}>
        <Icon name="alert" size={18} />
        <span className={styles.urgentText}>
          <strong>Feeling very unwell?</strong>
          <span>Get urgent help now, free.</span>
        </span>
      </Link>
    </aside>
  );
}
