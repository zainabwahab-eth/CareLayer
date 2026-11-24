import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '../../components/Alert/Alert';
import { Button } from '../../components/Button/Button';
import { TopBar } from '../../components/navigation/TopBar';
import { QuickExitButton } from '../../components/QuickExit/QuickExitButton';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { CHAT_PARAM, paths } from '../../routes/paths';
import { readAskPrefill } from './ask/ask-prefill';
import { AssistantAvatar, ChatMessage, TypingIndicator } from './ask/ChatMessage';
import { ChatComposer } from './ask/ChatComposer';
import { ChatContextRail } from './ask/ChatContextRail';
import { ChatEmptyState } from './ask/ChatEmptyState';
import { EmergencyNotice } from './ask/EmergencyNotice';
import { EscalationOfferCard } from './ask/EscalationOfferCard';
import styles from './AskPage.module.css';

const TITLE = 'CareLayer assistant';
const SUBTITLE = 'AI guidance, not a nurse';

/*
 * W06 Assistant chat (Figma: "W06 Assistant chat", "D-W06 Assistant chat").
 *
 * Every message goes to the assistant through the API (mock or HTTP). The
 * reply is either an answer (optionally with an offer to send the question
 * to a nurse) or an emergency. An emergency opens W13 straight away: it is
 * free, never queued and never offered to a nurse or paid for.
 */
export function AskPage() {
  const chat = useChat();
  const navigate = useNavigate();
  // W05 "Start with a topic": the composer starts with a few words she can edit.
  const { state: locationState } = useLocation();
  const prefill = readAskPrefill(locationState);
  const emptyTitleId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const isFirstScroll = useRef(true);

  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(CHAT_PARAM);
  const [openFailure, setOpenFailure] = useState<{
    id: string;
    result: 'not_found' | 'error';
  } | null>(null);
  const { conversationId, openConversation } = chat;
  /** The chat she just left with "New chat": its id lingers in the URL until navigation lands. */
  const [leftId, setLeftId] = useState<string | null>(null);
  if (leftId !== null && requested === null) setLeftId(null);
  const failedHere = requested !== null && openFailure?.id === requested ? openFailure : null;
  const opening =
    requested !== null && requested !== conversationId && !failedHere && requested !== leftId;

  // A saved chat in the URL (reload, or opened from History): load it.
  useEffect(() => {
    if (!requested || requested === conversationId || failedHere) return;
    if (requested === leftId) return;
    let cancelled = false;
    void openConversation(requested).then((result) => {
      if (!cancelled && result !== 'opened') setOpenFailure({ id: requested, result });
    });
    return () => {
      cancelled = true;
    };
  }, [requested, conversationId, failedHere, leftId, openConversation]);

  // Once her chat is saved, put it in the URL so a reload brings it back.
  useEffect(() => {
    if (conversationId && !requested) {
      setSearchParams({ [CHAT_PARAM]: conversationId }, { replace: true });
    }
  }, [conversationId, requested, setSearchParams]);

  const startNewChat = () => {
    setLeftId(requested);
    chat.reset();
    setOpenFailure(null);
    navigate(paths.ask);
    fieldRef.current?.focus();
  };

  const isEmpty = chat.entries.length === 0;
  const lastEntry = chat.entries.at(-1);

  // Keep the newest message, reply or offer in view.
  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({
      block: 'end',
      behavior: isFirstScroll.current || reduceMotion ? 'auto' : 'smooth',
    });
    isFirstScroll.current = false;
  }, [chat.entries.length, lastEntry, chat.pending, chat.offer]);

  // Start in the composer on desktop; on phones, don't pop the keyboard up uninvited.
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: coarse)').matches) fieldRef.current?.focus();
  }, []);

  const handleSend = (text: string) => {
    void chat.send(text).then((result) => {
      if (result.kind === 'emergency') {
        const state: EmergencyLocationState = { emergency: result.response };
        navigate(paths.emergency, { state });
      }
    });
    return true;
  };

  const handleRetry = (entryId: string) => {
    // "Try again" disappears once the message is re-sent; don't leave focus on nothing.
    fieldRef.current?.focus();
    void chat.retry(entryId).then((result) => {
      if (result.kind === 'emergency') {
        const state: EmergencyLocationState = { emergency: result.response };
        navigate(paths.emergency, { state });
      }
    });
  };

  const handleDismissOffer = () => {
    chat.dismissOffer();
    fieldRef.current?.focus();
  };

  // Only once there is something to leave: a blank chat is already new.
  const newChatButton =
    !isEmpty && !chat.pending ? (
      <Button variant="ghost" onClick={startNewChat} className={styles.newChat}>
        New chat
      </Button>
    ) : null;

  return (
    <div className={styles.page}>
      <div className={styles.chat}>
        <div className={styles.topBar}>
          <TopBar
            title={TITLE}
            subtitle={SUBTITLE}
            backTo={paths.home}
            backLabel="Back to home"
            actions={newChatButton}
          />
        </div>
        <header className={styles.header}>
          <AssistantAvatar size="large" />
          <div className={styles.titles}>
            <h1 className={styles.title}>{TITLE}</h1>
            <p className={styles.subtitle}>{SUBTITLE}</p>
          </div>
          {newChatButton}
          <QuickExitButton />
        </header>

        <div className={styles.messages}>
          <div className={styles.column}>
            {opening ? (
              <p className={styles.status} role="status">
                Opening your chat…
              </p>
            ) : failedHere ? (
              <div className={styles.status}>
                <Alert tone={failedHere.result === 'not_found' ? 'info' : 'error'}>
                  {failedHere.result === 'not_found'
                    ? 'This chat was deleted or is not yours.'
                    : 'We could not open this chat. Check your connection and try again.'}
                </Alert>
                <Button variant="secondary" onClick={startNewChat}>
                  Start a new chat
                </Button>
              </div>
            ) : isEmpty ? (
              <ChatEmptyState titleId={emptyTitleId} />
            ) : (
              <div role="log" aria-label="Conversation with your assistant" aria-live="polite">
                <ol className={styles.list} role="list">
                  {chat.entries.map((entry) =>
                    entry.kind === 'emergency' ? (
                      <EmergencyNotice key={entry.id} response={entry.response} />
                    ) : (
                      <ChatMessage
                        key={entry.id}
                        entry={entry}
                        onRetry={entry.kind === 'user' ? () => handleRetry(entry.id) : undefined}
                        retryDisabled={chat.pending}
                      />
                    ),
                  )}
                  {chat.pending && <TypingIndicator />}
                </ol>
              </div>
            )}

            {chat.offer && !chat.pending && (
              <EscalationOfferCard offer={chat.offer} onDismiss={handleDismissOffer} />
            )}
            {/* The offer sits outside the chat log, so announce it separately. */}
            <p className="visually-hidden" role="status">
              {chat.offer && !chat.pending
                ? 'Your assistant suggests a nurse or midwife checks this. The option to review and send is below the last message.'
                : ''}
            </p>
            <div ref={endRef} className={styles.end} aria-hidden />
          </div>
        </div>

        <ChatComposer
          onSend={handleSend}
          pending={chat.pending}
          canAskNurse={chat.canAskNurse}
          textareaRef={fieldRef}
          initialText={prefill}
        />
      </div>

      <ChatContextRail />
    </div>
  );
}
