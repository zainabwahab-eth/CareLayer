import type { ReactNode } from 'react';
import { PageHeader } from '../../../components/PageHeader/PageHeader';
import { TopBar } from '../../../components/navigation/TopBar';
import { DESKTOP_QUERY, useMediaQuery } from '../../../hooks/useMediaQuery';
import styles from './flow.module.css';

/*
 * Layout shared by W07-W11 (Figma "Women - mobile").
 *   Mobile: top bar (back, title, step or topic, quick exit) flush with the
 *           screen edge, then the body, with the actions at the bottom.
 *   Desktop: page header next to the sidebar, and the same body in one
 *           readable column (mobile frames are the source of truth).
 */
export interface FlowScreenProps {
  title: string;
  /** "Step 1 of 3", or the question's topic on W10/W11. */
  subtitle?: string;
  backTo: string;
  backLabel?: string;
  /** W07-W09: which of the three send steps this is (progress bar). */
  step?: 1 | 2 | 3;
  /** Buttons and notes pinned under the content (Figma: below the spacer). */
  footer?: ReactNode;
  children: ReactNode;
}

const STEPS = [1, 2, 3] as const;

export function FlowScreen({
  title,
  subtitle,
  backTo,
  backLabel,
  step,
  footer,
  children,
}: FlowScreenProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  return (
    <div className={styles.screen}>
      {isDesktop ? (
        <PageHeader title={title} subtitle={subtitle} />
      ) : (
        <TopBar title={title} subtitle={subtitle} backTo={backTo} backLabel={backLabel} />
      )}

      <div className={styles.body}>
        {step && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Sending to a nurse"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={step}
            aria-valuetext={`Step ${step} of 3`}
          >
            {STEPS.map((n) => (
              <span key={n} className={n <= step ? styles.progressDone : styles.progressTodo} />
            ))}
          </div>
        )}
        {children}
        {footer && (
          <>
            <div className={styles.spacer} aria-hidden />
            <div className={styles.footer}>{footer}</div>
          </>
        )}
      </div>
    </div>
  );
}
