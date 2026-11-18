import type { ReactNode } from 'react';
import { Badge } from '../Badge/Badge';
import { cx } from '../cx';
import { TopBar, type TopBarProps } from '../navigation/TopBar';
import { PageHeader, type PageHeaderProps } from '../PageHeader/PageHeader';
import styles from './ScreenPlaceholder.module.css';

/*
 * Temporary stand-in for a women's screen whose workflow is built in a later
 * phase. Renders the right header for the screen (mobile top bar or page
 * header) so the shell can be reviewed end to end, plus a labelled panel
 * pointing at the Figma frame the real screen must match.
 */
export interface ScreenPlaceholderProps {
  /** Figma frame id, e.g. "W05". */
  screenId: string;
  /** Figma frame name, e.g. "Home". */
  screenName: string;
  description: string;
  /**
   * Flow screens (W06-W11) use the mobile top bar. On desktop the same
   * title is shown as a page header, next to the sidebar.
   */
  topBar?: TopBarProps;
  /** Page header for screens without a top bar. `false` hides it. */
  header?: PageHeaderProps | false;
  /** Temporary links between placeholder screens, so the flow can be walked. */
  children?: ReactNode;
  className?: string;
}

export function ScreenPlaceholder({
  screenId,
  screenName,
  description,
  topBar,
  header,
  children,
  className,
}: ScreenPlaceholderProps) {
  return (
    <div className={cx(styles.screen, topBar && styles.withTopBar, className)}>
      {topBar ? (
        <>
          <TopBar {...topBar} className={styles.mobileOnly} />
          <PageHeader
            title={topBar.title}
            subtitle={topBar.subtitle}
            className={styles.desktopOnly}
          />
        </>
      ) : (
        header !== false && <PageHeader title={screenName} {...header} />
      )}

      <section className={styles.panel} aria-labelledby={`${screenId}-placeholder`}>
        <Badge variant="neutral">{screenId} · Placeholder</Badge>
        <h2 id={`${screenId}-placeholder`} className={styles.panelTitle}>
          {screenName}
        </h2>
        <p className={styles.description}>{description}</p>
        {children && <div className={styles.actions}>{children}</div>}
      </section>
    </div>
  );
}
