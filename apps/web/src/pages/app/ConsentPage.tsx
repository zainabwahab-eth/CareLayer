import { CHAT_LIMITS, type ChatTurn, type DraftResponse } from '@carelayer/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useApi } from '../../api/useApi';
import { useSessionGuard } from '../../auth/useSessionGuard';
import { isDraftExpired, type AskRequest } from '../../chat/ask-request';
import type { EmergencyLocationState } from '../../chat/emergency-state';
import { useChat } from '../../chat/useChat';
import { Alert } from '../../components/Alert/Alert';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import { DESKTOP_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { paths } from '../../routes/paths';
import { categoryLabel } from '../../utils/categories';
import { ageRangeLabel, pregnancyLabel } from '../../utils/question-details';
import styles from './ConsentPage.module.css';
import { FlowHeader } from './ask/FlowHeader';
import { FlowSteps } from './ask/FlowSteps';
import { flowErrorMessage } from './ask/flow-errors';

/** Longest question she can type when editing (one message, as on POST /chat/draft). */
const EDIT_MAX_LENGTH = CHAT_LIMITS.maxTextLength;

/**
 * W07 Consent (Figma: "W07 Consent" mobile, "D-W07 Consent" desktop).
 * Exactly what a nurse will receive, from POST /chat/draft, and nothing leaves
 * without her tick. The draft re-runs the red-flag check on the whole question:
 * an emergency goes to W13, never a nurse.
 *
 * Edit: the question becomes a text field; Save sends her edited question for a
 * fresh draft (the server signs exactly what the nurse will see, so the text can
 * only change through a new draft). Her consent is asked again for the new text.
 */
export function ConsentPage() {
  const chat = useChat();
  const api = useApi();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { canAskNurse, request, setRequest, thread, offeredFor } = chat;
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [agreed, setAgreed] = useState(request?.consented ?? false);
  const [showConsentError, setShowConsentError] = useState(false);
  const [editing, setEditing] = useState(false);
  useSessionGuard(error);

  const needsDraft = canAskNurse && (!request || isDraftExpired(request));
  const editedText = request?.editedText;

  /** Turn a draft response into the request (an emergency goes to W13 instead). */
  const applyDraft = (response: DraftResponse, edited?: string): boolean => {
    if (response.kind === 'emergency') {
      const state: EmergencyLocationState = { emergency: response };
      navigate(paths.emergency, { state, replace: true });
      return false;
    }
    setRequest((current): AskRequest => ({
      draft: response.draft,
      draftToken: response.draftToken,
      draftExpiresAt: response.draftExpiresAt,
      offer: response.offer,
      editedText: edited,
      notesRemoved: false,
      consented: false,
      // Keep her W08 choices if she came back for a fresh draft.
      nurseSelection: current?.nurseSelection ?? 'first_available',
      chosenNurse: current?.chosenNurse ?? null,
      femaleOnly: current?.femaleOnly ?? false,
    }));
    return true;
  };
  const applyDraftRef = useRef(applyDraft);
  useEffect(() => {
    applyDraftRef.current = applyDraft;
  });

  useEffect(() => {
    if (!needsDraft) return;
    let cancelled = false;
    // An edited question is drafted on its own. Otherwise the chat (the API's last 40 turns),
    // with a hint at the message the assistant offered a nurse for: the API sends only her
    // question to the nurse, and puts relevant details from the rest in the notes.
    const messages: ChatTurn[] = editedText
      ? [{ role: 'user', text: editedText }]
      : thread().slice(-CHAT_LIMITS.maxTurns);
    const focus = editedText ? -1 : lastIndexOfHers(messages, offeredFor);
    api.chat.draft({ messages, focusIndex: focus >= 0 ? focus : undefined }).then(
      (response) => {
        if (!cancelled) applyDraftRef.current(response, editedText);
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, needsDraft, attempt, thread, editedText, offeredFor]);

  // Nothing to consent to without her question (e.g. opened directly, or after a reload
  // without a saved chat). Send her back to the chat to ask it first.
  // After a reload her chat is reopened first (the flow itself is already back).
  if (chat.restoring) {
    return (
      <p className={styles.message} role="status">
        Loading your question…
      </p>
    );
  }
  if (!canAskNurse) return <Navigate to={paths.ask} replace />;

  const draft = needsDraft ? null : request?.draft;

  const handleContinue = () => {
    if (!agreed) {
      setShowConsentError(true);
      return;
    }
    setRequest((current) => (current ? { ...current, consented: true } : current));
    navigate(paths.askChoose);
  };

  const onSaved = (response: DraftResponse, text: string) => {
    if (applyDraft(response, text)) {
      // New text, new consent: she agrees to exactly what will be shared.
      setAgreed(false);
      setEditing(false);
    }
  };

  const consent = (
    <>
      <Checkbox
        checked={agreed}
        onChange={(event) => {
          setAgreed(event.target.checked);
          setShowConsentError(false);
        }}
        disabled={editing}
        error={showConsentError ? 'Tick this to send your question to a nurse.' : undefined}
      >
        I agree to share this with a verified nurse or midwife.
      </Checkbox>
      <Button fullWidth disabled={editing} onClick={handleContinue}>
        Continue
      </Button>
    </>
  );

  return (
    <div className={styles.page}>
      <FlowHeader
        title="Send to a nurse"
        subtitle="Step 1 of 3"
        desktopSubtitle="Review exactly what will be shared before anything leaves your device."
        backTo={paths.ask}
        backLabel="Back to the chat"
      />
      <FlowSteps current={1} />

      {!draft && !error && (
        <p className={styles.message} role="status">
          Preparing your question…
        </p>
      )}

      {!draft && Boolean(error) && (
        <div className={styles.errorBlock}>
          <Alert tone="error">
            {flowErrorMessage(error, 'We could not prepare your question. Please try again.')}
          </Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {draft && (
        <div className={styles.grid}>
          <div className={styles.shared}>
            <h2 className={styles.title}>Here’s exactly what the nurse will see</h2>

            <QuestionCard
              text={draft.cleanedText}
              editing={editing}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              onSaved={onSaved}
            />

            <div className={styles.details}>
              {draft.assistantNotes && (
                <Notes
                  notes={draft.assistantNotes}
                  removed={request?.notesRemoved ?? false}
                  disabled={editing}
                  onChange={(notesRemoved) =>
                    setRequest((current) => (current ? { ...current, notesRemoved } : current))
                  }
                />
              )}
              <AlsoShared
                badges={[
                  draft.ageRange ? ageRangeLabel(draft.ageRange) : null,
                  draft.pregnancyWeeks != null ? pregnancyLabel(draft.pregnancyWeeks) : null,
                  `Topic: ${categoryLabel(draft.category)}`,
                ]}
                card={isDesktop}
              />
            </div>

            <p className={styles.never}>
              <Icon name="lock" size={20} />
              <span>Never shared: your name, email, phone number or location.</span>
            </p>
          </div>

          {isDesktop ? (
            <aside className={styles.panel} aria-labelledby="consent-title">
              <h2 id="consent-title" className={styles.panelTitle}>
                Your consent
              </h2>
              {consent}
              <Button variant="ghost" fullWidth disabled={editing} onClick={() => setEditing(true)}>
                Edit question
              </Button>
            </aside>
          ) : (
            <div className={styles.mobileConsent}>{consent}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** "Your question": read-only with an Edit link, or a text field with Save / Cancel. */
function QuestionCard({
  text,
  editing,
  onEdit,
  onCancel,
  onSaved,
}: {
  text: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (response: DraftResponse, text: string) => void;
}) {
  const api = useApi();
  const fieldId = useId();
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Opening the editor (here or from "Edit question"): start from the current text.
  const [openedFor, setOpenedFor] = useState(false);
  if (editing && !openedFor) {
    setOpenedFor(true);
    setValue(text);
    setSaveError(null);
  } else if (!editing && openedFor) {
    setOpenedFor(false);
  }

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  const save = async () => {
    const edited = value.trim();
    if (!edited) {
      setSaveError('Your question can’t be empty.');
      return;
    }
    if (edited === text.trim()) {
      onCancel(); // nothing changed
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await api.chat.draft({ messages: [{ role: 'user', text: edited }] });
      onSaved(response, edited);
    } catch (error) {
      setSaveError(flowErrorMessage(error, 'Your changes were not saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby={`${fieldId}-title`}>
      <div className={styles.cardHead}>
        <h3 id={`${fieldId}-title`} className={styles.label}>
          Your question
        </h3>
        {!editing && (
          <button type="button" className={styles.edit} onClick={onEdit}>
            <Icon name="edit" size={14} />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <label htmlFor={fieldId} className="visually-hidden">
            Edit your question
          </label>
          <textarea
            id={fieldId}
            ref={fieldRef}
            className={styles.field}
            value={value}
            maxLength={EDIT_MAX_LENGTH}
            rows={4}
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
          />
          {saveError && <Alert tone="error">{saveError}</Alert>}
          <div className={styles.editActions}>
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <p className={styles.caption}>
            When you save, it is checked and tidied again, and you’re asked to agree to the new
            version.
          </p>
        </>
      ) : (
        <>
          <p className={styles.question}>{text}</p>
          <p className={styles.caption}>Spelling tidied. Nothing removed or shortened.</p>
        </>
      )}
    </section>
  );
}

/** Index of her latest message with this text (the one the nurse was offered for), or -1. */
function lastIndexOfHers(turns: readonly ChatTurn[], text: string | null): number {
  if (!text) return -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.role === 'user' && turns[i]!.text === text) return i;
  }
  return -1;
}

/**
 * "Notes from your assistant": relevant details from elsewhere in her chat. She can choose
 * not to share them (they are then left out of the consent and never reach the nurse).
 */
function Notes({
  notes,
  removed,
  disabled,
  onChange,
}: {
  notes: string;
  removed: boolean;
  disabled: boolean;
  onChange: (removed: boolean) => void;
}) {
  return (
    <section
      className={cx(styles.notes, removed && styles.notesRemoved)}
      aria-labelledby="consent-notes"
    >
      <div className={styles.cardHead}>
        <h3 id="consent-notes" className={styles.label}>
          Notes from your assistant
        </h3>
        <button
          type="button"
          className={styles.edit}
          disabled={disabled}
          onClick={() => onChange(!removed)}
        >
          {removed ? 'Include' : 'Don’t include'}
        </button>
      </div>
      {removed ? (
        <p className={styles.caption}>Not shared. The nurse will only see your question.</p>
      ) : (
        <p className={styles.bodyM}>{notes}</p>
      )}
    </section>
  );
}

/** "Also shared": a card on desktop, a row of badges on mobile (Figma). */
function AlsoShared({ badges, card }: { badges: Array<string | null>; card: boolean }) {
  const list = (
    <ul className={styles.badges} aria-label="Also shared">
      {badges
        .filter((b): b is string => Boolean(b))
        .map((label) => (
          <li key={label}>
            <Badge variant="neutral">{label}</Badge>
          </li>
        ))}
    </ul>
  );
  if (!card) return list;
  return (
    <section className={cx(styles.card, styles.alsoShared)} aria-labelledby="consent-also">
      <h3 id="consent-also" className={styles.label}>
        Also shared
      </h3>
      {list}
    </section>
  );
}
