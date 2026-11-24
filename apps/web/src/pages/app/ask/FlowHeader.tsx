import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../../components/Icon/Icon';
import { PageHeader } from '../../../components/PageHeader/PageHeader';
import { TopBar } from '../../../components/navigation/TopBar';
import { DESKTOP_QUERY, useMediaQuery } from '../../../hooks/useMediaQuery';
import styles from './FlowHeader.module.css';

/**
 * W07-W11 header. Mobile: the top bar (back, title, "Step N of 3", quick exit).
 * Desktop (Figma D-W07 "Header"): back arrow, Display/M title with a subtitle line,
 * quick exit. `desktopSubtitle` replaces the mobile step line on desktop, where the
 * stepper shows the step instead.
 */
export function FlowHeader({
  title,
  subtitle,
  desktopSubtitle,
  backTo,
  backLabel = 'Back',
  actions,
}: {
  title: string;
  subtitle?: string;
  desktopSubtitle?: string;
  backTo: string;
  backLabel?: string;
  /** Desktop only: shown before Quick exit (e.g. W10's "In review" badge). */
  actions?: ReactNode;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  if (!isDesktop) {
    return <TopBar title={title} subtitle={subtitle} backTo={backTo} backLabel={backLabel} />;
  }
  return (
    <div className={styles.desktop}>
      <Link to={backTo} className={styles.back} aria-label={backLabel}>
        <Icon name="back" size={24} />
      </Link>
      <PageHeader
        title={title}
        subtitle={desktopSubtitle ?? subtitle}
        actions={actions}
        className={styles.header}
      />
    </div>
  );
}
