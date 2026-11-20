import type { User } from '@carelayer/shared';
import { useState, type FormEvent } from 'react';
import { isApiError } from '../../../api/errors';
import { useApi } from '../../../api/useApi';
import { useAuth } from '../../../auth/useAuth';
import { useSessionGuard } from '../../../auth/useSessionGuard';
import { Avatar } from '../../../components/Avatar/Avatar';
import { Button } from '../../../components/Button/Button';
import { Input } from '../../../components/Input/Input';
import styles from '../AccountPage.module.css';

/** Same limit as sign-up's "What should we call you?" (contract §2, women). */
const NAME_MAX = 50;

/** Name and email. She can change what we call her (PATCH /me); the email is fixed. */
export function ProfileCard({ user }: { user: User }) {
  const api = useApi();
  const { updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sessionError, setSessionError] = useState<unknown>();
  useSessionGuard(sessionError);

  const startEditing = () => {
    setName(user.displayName);
    setError(undefined);
    setSaved(false);
    setEditing(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Tell us what to call you.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Use ${NAME_MAX} characters or fewer.`);
      return;
    }
    if (trimmed === user.displayName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      updateUser(await api.me.update({ displayName: trimmed }));
      setEditing(false);
      setSaved(true);
    } catch (caught) {
      setSessionError(caught);
      setError(
        isApiError(caught) && caught.code === 'VALIDATION_FAILED'
          ? caught.message
          : isApiError(caught) && caught.status === 0
            ? 'Could not reach CareLayer. Check your connection and try again.'
            : 'We could not save your name. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="profile-title">
      <h2 id="profile-title" className="visually-hidden">
        Your profile
      </h2>
      <div className={styles.profile}>
        <Avatar name={user.displayName} size={44} decorative />
        <div className={styles.identity}>
          <p className={styles.name}>{user.displayName}</p>
          <p className={styles.email}>{user.email}</p>
        </div>
        {!editing && (
          <Button variant="ghost" onClick={startEditing} className={styles.edit}>
            Edit<span className="visually-hidden"> name</span>
          </Button>
        )}
      </div>

      {editing && (
        <form className={styles.nameForm} onSubmit={handleSubmit} noValidate>
          <Input
            label="What should we call you?"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            hint="Only you see this. Nurses never see your name."
            error={error}
            autoFocus
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <p className={styles.status} role="status">
        {saved ? 'Name saved.' : ''}
      </p>
    </section>
  );
}
