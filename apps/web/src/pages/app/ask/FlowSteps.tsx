import { cx } from '../../../components/cx';
import { DESKTOP_QUERY, useMediaQuery } from '../../../hooks/useMediaQuery';
import styles from './FlowSteps.module.css';

const STEPS = ['What’s shared', 'Who answers', 'Confirm and send'] as const;

/**
 * W07-W09 progress. Desktop (Figma D-W07 "Stepper"): numbered dots with labels joined
 * by lines; done and current steps are filled. Mobile (W07 "Progress"): three bars.
 */
export function FlowSteps({ current }: { current: 1 | 2 | 3 }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const label = `Step ${current} of 3: ${STEPS[current - 1]}`;

  if (!isDesktop) {
    return (
      <div className={styles.bars} role="img" aria-label={label}>
        {STEPS.map((step, index) => (
          <span key={step} className={cx(styles.bar, index < current && styles.barDone)} />
        ))}
      </div>
    );
  }

  return (
    <ol className={styles.stepper} aria-label="Progress">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const state = number < current ? 'done' : number === current ? 'current' : 'next';
        return (
          <li
            key={step}
            className={cx(styles.step, state !== 'next' && styles.stepActive)}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={styles.dot} aria-hidden>
              {number}
            </span>
            <span className={styles.label}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
