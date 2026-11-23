import { BackLink } from '@web/components/BackLink/BackLink';
import styles from './StepHeader.module.css';

/*
 * Figma N02/N03 top of the body: icon/back, then "Progress" (three 4px bars,
 * 6px apart, and a caption such as "Step 1 of 3, about 5 minutes").
 */
export function StepHeader({
  step,
  total = 3,
  caption,
  back,
}: {
  step: number;
  total?: number;
  caption?: string;
  back?: { to: string; label: string };
}) {
  return (
    <div className={styles.header}>
      {back && <BackLink to={back.to} label={back.label} />}
      <div className={styles.progress}>
        <div
          className={styles.bars}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step}
          aria-valuetext={`Step ${step} of ${total}`}
          aria-label="Application progress"
        >
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i < step ? styles.barDone : styles.bar} />
          ))}
        </div>
        <p className={styles.caption}>{caption ?? `Step ${step} of ${total}`}</p>
      </div>
    </div>
  );
}
