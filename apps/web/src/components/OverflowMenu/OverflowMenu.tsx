import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../cx';
import { IconButton } from '../IconButton/IconButton';
import styles from './OverflowMenu.module.css';

export interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  /** "danger" for destructive actions (e.g. Delete). */
  tone?: 'default' | 'danger';
}

export interface OverflowMenuProps {
  /** Accessible name of the "⋯" button, e.g. "More options for: My period is late". */
  label: string;
  items: readonly OverflowMenuItem[];
  className?: string;
}

/**
 * "⋯" button that opens a small menu of actions (no Figma frame; built from the
 * card and IconButton tokens). Closes on choosing an item, Escape, or a tap
 * outside. Arrow keys move between items; focus returns to the button.
 */
export function OverflowMenu({ label, items, className }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => b !== null);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // not the quick-exit "Esc Esc" on its own
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cx(styles.root, className)}>
      <IconButton
        ref={buttonRef}
        icon="more"
        iconSize={20}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cx(styles.button, open && styles.buttonOpen)}
      />
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className={cx(styles.item, item.tone === 'danger' && styles.danger)}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
