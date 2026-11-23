import type { NurseDocumentType } from '@carelayer/shared';
import { loadErrorMessage } from '@web/api/error-message';
import { hasErrorCode, isApiError } from '@web/api/errors';
import { isSessionError } from '@web/auth/auth-flow';
import { Alert } from '@web/components/Alert/Alert';
import { Button } from '@web/components/Button/Button';
import { Icon } from '@web/components/Icon/Icon';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useNurseApi } from '../../api/api-context';
import { useAuth } from '../../auth/useAuth';
import { StepHeader } from '../../components/StepHeader';
import {
  DOCUMENT_SLOTS,
  checkDocumentFile,
  isLocked,
  missingDocuments,
} from '../../onboarding/onboarding';
import { useReadyProfile } from '../../onboarding/profile-context';
import { paths } from '../../routes/paths';
import { DocumentRow, type RowStatus } from './DocumentRow';
import styles from './onboarding.module.css';

/*
 * N03 Documents (Figma "N03 Documents", "D-N03"). Step 2 of 3.
 * Each file goes up on its own as soon as she picks it (POST /nurse/documents),
 * so a slow connection never loses the others. Re-picking replaces; Remove deletes.
 * The server checks the real file type from its bytes; we only pre-check size and kind.
 */
export function DocumentsPage() {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const { profile, setProfile, reload } = useReadyProfile();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Partial<Record<NurseDocumentType, RowStatus>>>({});
  const [formError, setFormError] = useState<string>();
  const locked = isLocked(profile);

  const setRow = (type: NurseDocumentType, status: RowStatus) =>
    setRows((current) => ({ ...current, [type]: status }));

  const handleError = (type: NurseDocumentType, error: unknown, fallback: string) => {
    if (isSessionError(error)) return sessionExpired();
    if (hasErrorCode(error, 'CONFLICT')) {
      setRow(type, { kind: 'idle' });
      setFormError((error as Error).message);
      void reload();
      return;
    }
    const isFileProblem =
      isApiError(error) &&
      (error.status === 413 ||
        (error.code === 'VALIDATION_FAILED' && error.details?.field === 'file'));
    setRow(type, {
      kind: 'error',
      message: isFileProblem ? (error as Error).message : loadErrorMessage(error, fallback),
    });
  };

  const upload = async (type: NurseDocumentType, file: File) => {
    setFormError(undefined);
    const problem = checkDocumentFile(file);
    if (problem) return setRow(type, { kind: 'error', message: problem });
    setRow(type, { kind: 'uploading' });
    try {
      const doc = await api.nurse.uploadDocument(type, file);
      setProfile((current) => ({
        ...current,
        documents: [...current.documents.filter((d) => d.type !== type), doc],
      }));
      setRow(type, { kind: 'idle' });
    } catch (error) {
      handleError(type, error, 'The upload did not finish. Check your connection and try again.');
    }
  };

  const remove = async (type: NurseDocumentType, documentId: string) => {
    setFormError(undefined);
    setRow(type, { kind: 'uploading' });
    try {
      await api.nurse.removeDocument(documentId);
      setProfile((current) => ({
        ...current,
        documents: current.documents.filter((d) => d.id !== documentId),
      }));
      setRow(type, { kind: 'idle' });
    } catch (error) {
      if (hasErrorCode(error, 'NOT_FOUND')) {
        // Already gone (another device): just catch up.
        void reload();
        setRow(type, { kind: 'idle' });
        return;
      }
      handleError(type, error, 'We could not remove it. Please try again.');
    }
  };

  const anyUploading = Object.values(rows).some((r) => r?.kind === 'uploading');
  const missing = missingDocuments(profile);

  const handleContinue = () => {
    if (anyUploading) return;
    if (missing.length) {
      setFormError(
        missing.length === 1
          ? 'Upload the last document to continue.'
          : `Upload all four documents to continue. ${missing.length} still to go.`,
      );
      return;
    }
    navigate(paths.submit);
  };

  return (
    <div className={styles.page}>
      <StepHeader step={2} back={{ to: paths.licence, label: 'Back to your licence' }} />
      <h1 className={styles.title}>Upload your documents</h1>
      <p className={styles.lede}>Clear photos or PDFs. Only our verification team sees them.</p>

      {formError && <Alert tone="error">{formError}</Alert>}

      <ul role="list" className={styles.list} aria-label="Documents">
        {DOCUMENT_SLOTS.map((slot) => {
          const document = profile.documents.find((d) => d.type === slot.type);
          return (
            <li key={slot.type}>
              <DocumentRow
                slot={slot}
                document={document}
                status={rows[slot.type] ?? { kind: 'idle' }}
                locked={locked}
                onFile={(file) => void upload(slot.type, file)}
                onRemove={() => document && void remove(slot.type, document.id)}
              />
            </li>
          );
        })}
      </ul>

      <div className={styles.actions}>
        <p className={styles.note}>
          <Icon name="shield" size={16} className={styles.noteIcon} />
          Stored encrypted. Never shown to the women you help.
        </p>
        <Button fullWidth onClick={handleContinue} disabled={anyUploading}>
          {anyUploading ? 'Uploading…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
