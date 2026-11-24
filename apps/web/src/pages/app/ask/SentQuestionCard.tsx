import type { Id, MyQuestion } from '@carelayer/shared';
import { Link } from 'react-router';
import { useApiQuery } from '../../../api/useApiQuery';
import { Avatar } from '../../../components/Avatar/Avatar';
import { Badge } from '../../../components/Badge/Badge';
import { Icon } from '../../../components/Icon/Icon';
import { consultationPath, consultationWaitingPath } from '../../../routes/paths';
import { nurseLine } from '../../../utils/nurses';
import { questionTitle, statusBadge } from '../history/question-display';
import styles from './SentQuestionCard.module.css';

/** Longest answer shown in the chat; the rest is one tap away on W11. */
const PREVIEW_LENGTH = 280;

/**
 * A question she sent to a nurse from this chat, where she sent it: its status, and the
 * nurse's answer once she has opened it (GET /me/questions/:id). No Figma frame: built
 * from the W06 offer card and the W12 status badges.
 */
export function SentQuestionCard({ questionId }: { questionId: Id }) {
  const question = useApiQuery((api) => api.questions.getMine(questionId), [questionId]);

  return (
    <li className={styles.card} aria-label="Question sent to a nurse">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden>
          <Icon name="shield" size={20} />
        </span>
        <span className={styles.heading}>Sent to a nurse</span>
        {question.data && <StatusBadge question={question.data} />}
      </div>
      {question.status === 'loading' && <p className={styles.muted}>Loading…</p>}
      {question.status === 'error' && (
        <p className={styles.muted}>We could not load this question.</p>
      )}
      {question.data && <Body question={question.data} />}
    </li>
  );
}

function StatusBadge({ question }: { question: MyQuestion }) {
  const badge = statusBadge(question);
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

function Body({ question }: { question: MyQuestion }) {
  const title = <p className={styles.question}>{questionTitle(question)}</p>;

  // Answered and opened: the answer itself, with who wrote it.
  if (question.answer) {
    const text = question.answer.text;
    const preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
    return (
      <>
        {title}
        <div className={styles.answer}>
          <span className={styles.nurse}>
            <Avatar name={question.answer.nurse.displayName} size={28} decorative />
            {nurseLine(question.answer.nurse)}
          </span>
          <p className={styles.answerText}>{preview}</p>
        </div>
        <Link to={consultationPath(question.id)} className={styles.link}>
          {preview === text ? 'See the full answer and receipt' : 'Read the full answer'}
        </Link>
      </>
    );
  }

  if (question.status === 'answered') {
    return (
      <>
        {title}
        <p className={styles.muted}>A nurse has answered. Opening it uses your answer payment.</p>
        <Link to={consultationPath(question.id)} className={styles.link}>
          Open the answer
        </Link>
      </>
    );
  }

  if (question.status === 'open' || question.status === 'claimed') {
    return (
      <>
        {title}
        <p className={styles.muted}>
          {question.status === 'claimed'
            ? 'A nurse is reviewing it now.'
            : 'Waiting for a verified nurse to pick it up.'}
        </p>
        <Link to={consultationWaitingPath(question.id)} className={styles.link}>
          See its status
        </Link>
      </>
    );
  }

  return (
    <>
      {title}
      <p className={styles.muted}>
        {question.status === 'expired'
          ? 'No nurse was free in time. You were not charged.'
          : 'It was withdrawn before a nurse answered.'}
      </p>
    </>
  );
}
