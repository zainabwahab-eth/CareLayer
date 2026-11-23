import type { NurseDocument } from '@carelayer/shared';
import { cx } from '@web/components/cx';
import { Icon } from '@web/components/Icon/Icon';
import { useId, useRef } from 'react';
import { DOCUMENT_ACCEPT, formatFileSize, type DocumentSlot } from '../../onboarding/onboarding';
import styles from './DocumentRow.module.css';

export type RowStatus =
  { kind: 'idle' } | { kind: 'uploading' } | { kind: 'error'; message: string };

/*
 * One Figma N03 "Upload / …" row.
 *   Missing:  dashed border, upload (or camera) icon on surface-soft, the hint.
 *   Uploaded: solid border, check on primary-soft, "Uploaded, <file name>".
 * The whole row is the file picker's label, so a tap anywhere opens it; the
 * input stays focusable for keyboards. Uploaded rows can be replaced or removed.
 */
export function DocumentRow({
  slot,
  document,
  status,
  locked,
  onFile,
  onRemove,
}: {
  slot: DocumentSlot;
  document: NurseDocument | undefined;
  status: RowStatus;
  locked: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = status.kind === 'uploading';
  const error = status.kind === 'error' ? status.message : undefined;
  const done = Boolean(document) && !uploading;

  const detail = uploading
    ? 'Uploading…'
    : document
      ? `Uploaded, ${document.fileName}`
      : slot.description;

  return (
    <div className={styles.wrapper}>
      <div className={styles.rowLine}>
        <label
          htmlFor={id}
          className={cx(
            styles.row,
            done ? styles.done : styles.missing,
            error && styles.invalid,
            (locked || uploading) && styles.disabled,
          )}
        >
          <input
            ref={inputRef}
            id={id}
            type="file"
            className="visually-hidden"
            accept={slot.capture ? 'image/*' : DOCUMENT_ACCEPT}
            capture={slot.capture}
            disabled={locked || uploading}
            aria-describedby={`${id}-detail${error ? ` ${id}-error` : ''}`}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clear so choosing the same file again still fires a change.
              event.target.value = '';
              if (file) onFile(file);
            }}
          />
          <span className={cx(styles.icon, done && styles.iconDone)} aria-hidden>
            <Icon name={done ? 'check' : slot.capture ? 'camera' : 'upload'} size={20} />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              {slot.title}
              {document && !uploading && (
                <span className="visually-hidden">: uploaded. Choose to replace.</span>
              )}
            </span>
            <span
              id={`${id}-detail`}
              className={styles.detail}
              role={uploading ? 'status' : undefined}
            >
              {detail}
              {document && !uploading && (
                <span className="visually-hidden"> ({formatFileSize(document.sizeBytes)})</span>
              )}
            </span>
          </span>
        </label>
        {document && !uploading && !locked && (
          <button
            type="button"
            className={styles.remove}
            onClick={onRemove}
            aria-label={`Remove ${slot.title.toLowerCase()}`}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
