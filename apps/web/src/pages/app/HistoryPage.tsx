import { PageHeader } from '../../components/PageHeader/PageHeader';
import styles from './HistoryPage.module.css';
import { ChatHistory } from './history/ChatHistory';

/**
 * History: her saved chats with the assistant, most recently active first
 * (GET /chat/conversations). Questions sent to nurses are under Consultations.
 * No Figma frame: built from the W12 card pattern.
 */
export function HistoryPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="History"
        subtitle="Your chats with the assistant. Only you can see them."
      />
      <ChatHistory />
    </div>
  );
}
