import { Icon } from '../../../components/Icon/Icon';
import { cx } from '../../../components/cx';
import type { ChatEntry } from '../../../chat/chat-context';
import styles from './ChatMessage.module.css';

/*
 * Figma W06 "Her message" (rose-soft, right) and "Assistant message"
 * (surface bubble with sparkle avatar, left). The assistant is AI guidance,
 * never presented as a nurse or doctor.
 */
type MessageEntry = Extract<ChatEntry, { kind: 'user' | 'assistant' }>;

export interface ChatMessageProps {
  entry: MessageEntry;
  onRetry?: () => void;
  /** Disable Try again while another message is being answered. */
  retryDisabled?: boolean;
}

export function ChatMessage({ entry, onRetry, retryDisabled }: ChatMessageProps) {
  if (entry.kind === 'assistant') {
    return (
      <li className={cx(styles.row, styles.assistant)}>
        <AssistantAvatar />
        <div className={cx(styles.bubble, styles.assistantBubble)}>
          <span className="visually-hidden">Assistant: </span>
          <p className={styles.text}>{entry.text}</p>
        </div>
      </li>
    );
  }

  const failed = entry.status === 'failed';
  return (
    <li className={cx(styles.row, styles.user)} aria-busy={entry.status === 'sending'}>
      <div className={cx(styles.bubble, styles.userBubble, failed && styles.failedBubble)}>
        <span className="visually-hidden">You: </span>
        <p className={styles.text}>{entry.text}</p>
      </div>
      {failed && (
        <div className={styles.failure} role="alert">
          <Icon name="alert" size={14} className={styles.failureIcon} />
          <span>{entry.error ?? 'Your message was not sent.'}</span>
          {onRetry && (
            <button
              type="button"
              className={styles.retry}
              onClick={onRetry}
              disabled={retryDisabled}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function AssistantAvatar({ size = 'small' }: { size?: 'small' | 'large' }) {
  return (
    <span className={cx(styles.avatar, size === 'large' && styles.avatarLarge)} aria-hidden>
      <Icon name="sparkle" size={size === 'large' ? 20 : 16} />
    </span>
  );
}

/** Shown while the assistant is replying. Announced once through the chat log. */
export function TypingIndicator() {
  return (
    <li className={cx(styles.row, styles.assistant)}>
      <AssistantAvatar />
      <div className={cx(styles.bubble, styles.assistantBubble, styles.typing)}>
        <span className="visually-hidden">The assistant is replying…</span>
        <span className={styles.dot} aria-hidden />
        <span className={styles.dot} aria-hidden />
        <span className={styles.dot} aria-hidden />
      </div>
    </li>
  );
}
