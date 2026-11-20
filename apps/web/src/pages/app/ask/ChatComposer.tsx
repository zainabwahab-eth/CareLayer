import {
  useId,
  useLayoutEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../../../components/Icon/Icon';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../../chat/chat-context';
import { paths } from '../../../routes/paths';
import styles from './ChatComposer.module.css';

/*
 * Figma W06 "Composer" (mobile: "Ask a nurse directly" chip above the field)
 * and D-W06 "Composer" (one 720px pill: field, chip, send).
 * Enter sends on devices with a keyboard; Shift+Enter adds a line. On touch
 * keyboards Enter adds a line and the send button sends.
 */
export interface ChatComposerProps {
  /** Called with the trimmed text. Return false to keep the text in the field. */
  onSend: (text: string) => boolean;
  /** A reply is on its way: she can keep typing but not send yet. */
  pending: boolean;
  /**
   * She has a question the assistant has answered, so it can go to a nurse.
   * Until then "Ask a nurse directly" explains what to do instead of opening consent.
   */
  canAskNurse: boolean;
  /** The parent focuses the field (on open, after "Not now"). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const COUNTER_FROM = Math.floor(CHAT_MESSAGE_MAX_LENGTH * 0.9);

export function ChatComposer({ onSend, pending, canAskNurse, textareaRef }: ChatComposerProps) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [askHint, setAskHint] = useState<string | null>(null);
  const fieldRef = textareaRef;
  const baseId = useId();
  const fieldId = `${baseId}-field`;
  const counterId = `${baseId}-counter`;
  const noteId = `${baseId}-note`;

  const trimmed = text.trim();
  const overBy = trimmed.length - CHAT_MESSAGE_MAX_LENGTH;
  const tooLong = overBy > 0;
  const canSend = trimmed.length > 0 && !tooLong && !pending;
  const showCounter = text.length >= COUNTER_FROM;
  // One announced note: the length problem wins over the ask-a-nurse hint.
  const note = tooLong
    ? `Too long by ${overBy} ${overBy === 1 ? 'character' : 'characters'}. Shorten your message to send it.`
    : askHint;
  const describedBy = [showCounter && counterId, note && noteId].filter(Boolean).join(' ');

  // Grow with the text, up to about five lines, then scroll.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [text, fieldRef]);

  const submit = () => {
    if (!canSend) return;
    if (onSend(trimmed)) {
      setText('');
      setAskHint(null);
    }
    // The send button disables itself once the field is empty; keep focus in the field.
    fieldRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    event.preventDefault();
    submit();
  };

  const handleAskNurse = () => {
    if (canAskNurse) {
      navigate(paths.askConsent);
      return;
    }
    // Consent needs her question: never open it with nothing to send.
    setAskHint(
      trimmed
        ? 'Send your message first. Then you can choose to send it to a nurse or midwife.'
        : 'Write your question first. Then you can choose to send it to a nurse or midwife.',
    );
    fieldRef.current?.focus();
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.composer} onSubmit={handleSubmit}>
        <label htmlFor={fieldId} className="visually-hidden">
          Message your assistant
        </label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          className={styles.field}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your assistant"
          aria-describedby={describedBy || undefined}
          aria-invalid={tooLong || undefined}
          autoComplete="off"
        />

        <button type="button" className={styles.askNurse} onClick={handleAskNurse}>
          <Icon name="shield" size={14} />
          <span>Ask a nurse directly</span>
        </button>

        <button
          type="submit"
          className={styles.send}
          disabled={!canSend}
          aria-label={pending ? 'Send message (waiting for the assistant)' : 'Send message'}
        >
          <Icon name="send" size={20} />
        </button>

        {note && (
          <p id={noteId} className={tooLong ? styles.noteError : styles.note} aria-hidden>
            {note}
          </p>
        )}
        {/* Always in the DOM so screen readers announce each change. */}
        <p className="visually-hidden" aria-live="polite">
          {note}
        </p>
        {showCounter && !tooLong && (
          <p id={counterId} className={styles.counter}>
            {CHAT_MESSAGE_MAX_LENGTH - text.length} characters left
          </p>
        )}
      </form>
    </div>
  );
}
