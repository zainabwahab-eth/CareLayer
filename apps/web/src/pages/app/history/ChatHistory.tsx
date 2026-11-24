import { NEW_CHAT_STATE } from '../../../chat/ask-route-state';
import type { ConversationSummary } from '@carelayer/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { loadErrorMessage } from '../../../api/error-message';
import { useApi } from '../../../api/useApi';
import { usePagedQuery } from '../../../api/usePagedQuery';
import { useSessionGuard } from '../../../auth/useSessionGuard';
import { useChat } from '../../../chat/useChat';
import { Alert } from '../../../components/Alert/Alert';
import { Button, ButtonLink } from '../../../components/Button/Button';
import { OverflowMenu } from '../../../components/OverflowMenu/OverflowMenu';
import { chatPath, paths } from '../../../routes/paths';
import { formatFullDate, formatListDate } from '../../../utils/dates';
import historyStyles from '../HistoryPage.module.css';
import styles from './ChatHistory.module.css';

const PAGE_SIZE = 50;

/**
 * History → Assistant chats: her saved chats, most recently active first
 * (GET /chat/conversations). Opening one continues it; Delete removes it for good
 * (DELETE /chat/conversations/:id). No Figma frame: built from the W12 cards.
 */
export function ChatHistory() {
  const api = useApi();
  const chat = useChat();
  const chats = usePagedQuery((client, cursor) =>
    client.chat.listConversations({ cursor, limit: PAGE_SIZE }),
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  useSessionGuard(chats.error, chats.loadMoreError, deleteError);

  const remove = async (conversation: ConversationSummary) => {
    setDeleting(conversation.id);
    setDeleteError(null);
    try {
      await api.chat.deleteConversation(conversation.id);
      // The deleted chat may be the one open on the Ask screen: start that afresh.
      if (chat.conversationId === conversation.id) chat.reset();
      setConfirming(null);
      chats.reload();
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(null);
    }
  };

  if (chats.status === 'loading') {
    return (
      <p className={historyStyles.message} role="status">
        Loading your chats…
      </p>
    );
  }

  if (chats.status === 'error') {
    return (
      <>
        <Alert tone="error">{loadErrorMessage(chats.error, 'We could not load your chats.')}</Alert>
        <Button variant="secondary" onClick={chats.reload} className={historyStyles.retry}>
          Try again
        </Button>
      </>
    );
  }

  if (chats.items.length === 0) {
    return (
      <section className={historyStyles.empty} aria-labelledby="chats-empty">
        <h2 id="chats-empty" className={historyStyles.emptyTitle}>
          No chats yet
        </h2>
        <p className={historyStyles.emptyText}>
          Your chats with the assistant are saved here, so you can come back to them. Only you can
          see them.
        </p>
        <ButtonLink to={paths.ask} state={NEW_CHAT_STATE}>
          Start a chat
        </ButtonLink>
      </section>
    );
  }

  return (
    <>
      {Boolean(deleteError) && (
        <Alert tone="error">
          {loadErrorMessage(deleteError, 'That chat was not deleted. Please try again.')}
        </Alert>
      )}

      <ul role="list" className={historyStyles.cards}>
        {chats.items.map((c) => (
          <li key={c.id} className={styles.card}>
            <Link to={chatPath(c.id)} className={styles.link}>
              <time
                dateTime={c.updatedAt}
                title={formatFullDate(c.updatedAt)}
                className={historyStyles.cardDate}
              >
                {formatListDate(c.updatedAt, { weekday: true })}
              </time>
              <span className={historyStyles.cardTitle}>{c.title}</span>
              {c.preview && c.preview !== c.title && (
                <span className={styles.preview}>{c.preview}</span>
              )}
            </Link>

            <OverflowMenu
              label={`More options for: ${c.title}`}
              className={styles.menu}
              items={[
                { label: 'Delete chat', tone: 'danger', onSelect: () => setConfirming(c.id) },
              ]}
            />

            {confirming === c.id && (
              <div className={styles.confirm} role="group" aria-label="Delete this chat">
                <span className={styles.confirmText}>Delete this chat for good?</span>
                <div className={styles.confirmActions}>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="emergency"
                    onClick={() => void remove(c)}
                    disabled={deleting === c.id}
                  >
                    {deleting === c.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {chats.loadMoreError && (
        <Alert tone="error">
          {loadErrorMessage(chats.loadMoreError, 'We could not load more chats.')}
        </Alert>
      )}
      {chats.hasMore && (
        <Button
          variant="secondary"
          onClick={chats.loadMore}
          disabled={chats.loadingMore}
          className={historyStyles.more}
        >
          {chats.loadingMore ? 'Loading…' : 'Show older chats'}
        </Button>
      )}
    </>
  );
}
