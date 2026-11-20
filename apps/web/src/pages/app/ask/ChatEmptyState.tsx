import { Link } from 'react-router';
import { Icon } from '../../../components/Icon/Icon';
import { paths } from '../../../routes/paths';
import { AssistantAvatar } from './ChatMessage';
import styles from './ChatEmptyState.module.css';

/*
 * New chat (no Figma frame: built from W06's tokens and D-W06's "About this
 * chat" copy). Sets expectations up front: AI guidance, not a nurse or
 * doctor; it does not diagnose or prescribe; nothing is shared without consent.
 */
export function ChatEmptyState({ titleId }: { titleId: string }) {
  return (
    <div className={styles.empty}>
      <AssistantAvatar size="large" />
      <h2 id={titleId} className={styles.title}>
        Ask anything, privately
      </h2>
      <p className={styles.lede}>
        Write in your own words. Your assistant explains and suggests next steps.
      </p>
      <ul className={styles.points} role="list">
        <li>
          <Icon name="sparkle" size={16} className={styles.pointIcon} />
          <span>It is AI guidance, not a nurse or doctor. It cannot diagnose or prescribe.</span>
        </li>
        <li>
          <Icon name="shield" size={18} className={styles.pointIcon} />
          <span>
            If a professional should look, it offers to send your question to a verified nurse or
            midwife.
          </span>
        </li>
        <li>
          <Icon name="lock" size={18} className={styles.pointIcon} />
          <span>Nothing is shared with a nurse without your consent.</span>
        </li>
      </ul>
      {/* Desktop shows this in the context rail. */}
      <Link to={paths.emergency} className={styles.urgent}>
        <Icon name="alert" size={18} />
        <span>
          <strong>Feeling very unwell?</strong> Get urgent help now, free.
        </span>
      </Link>
    </div>
  );
}
