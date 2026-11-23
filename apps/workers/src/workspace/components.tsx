import type { NurseQuestionView } from '@carelayer/shared';
import { loadErrorMessage } from '@web/api/error-message';
import { Alert } from '@web/components/Alert/Alert';
import { Button, ButtonLink } from '@web/components/Button/Button';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import type { IconName } from '@web/components/Icon/icons';
import { categoryLabel } from '@web/utils/categories';
import { formatNaira } from '@web/utils/money';
import type { ReactNode } from 'react';
import { casePath } from '../routes/paths';
import { ANSWER_SHARE_KOBO, contextLine, waitingLabel } from './format';
import styles from './workspace.module.css';

/** A failed load: what happened, and Try again. Never sample data. */
export function LoadError({
  error,
  fallback,
  onRetry,
}: {
  error: unknown;
  fallback: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.stack}>
      <Alert tone="error">{loadErrorMessage(error, fallback)}</Alert>
      <div>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** Placeholder blocks while a screen loads. */
export function Skeleton({ count = 3, height = '7rem' }: { count?: number; height?: string }) {
  return (
    <div className={styles.page} aria-busy="true">
      <span className={styles.srOnly} role="status">
        Loading…
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeleton} style={{ height }} aria-hidden />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = 'check',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.listIcon} aria-hidden>
        <Icon name={icon} size={20} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.bodySmall}>{children}</p>}
      {action}
    </div>
  );
}

/** Topic and what she shared: "Pregnancy", "Age 25–34", "30 weeks". */
export function CaseTags({ question }: { question: NurseQuestionView }) {
  return (
    <div className={styles.tags}>
      <span className={styles.tag}>{categoryLabel(question.category)}</span>
      {question.chosenForYou && (
        <span className={cx(styles.tag, styles.tagChosen)}>Chosen for you</span>
      )}
      {question.femaleOnly && <span className={styles.tag}>Female health worker asked</span>}
    </div>
  );
}

/** One waiting question (N05, N06). Opens the question to read it in full and claim. */
export function CaseCard({ question, now }: { question: NurseQuestionView; now: number }) {
  const context = contextLine(question);
  const meta = [context, waitingLabel(question.createdAt, now)].filter(Boolean).join('. ');
  return (
    <article className={styles.card} aria-label={`${categoryLabel(question.category)} question`}>
      <div className={styles.row}>
        <CaseTags question={question} />
        <span className={styles.reward}>{formatNaira(ANSWER_SHARE_KOBO)}</span>
      </div>
      <p className={styles.body}>{question.cleanedText}</p>
      <div className={styles.row}>
        <span className={styles.meta}>
          <Icon name="clock" size={16} />
          {meta}
        </span>
        <ButtonLink
          to={casePath(question.id)}
          aria-label={`Answer: ${question.cleanedText.slice(0, 60)}`}
        >
          Answer
        </ButtonLink>
      </div>
    </article>
  );
}
