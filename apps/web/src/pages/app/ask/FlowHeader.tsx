import { PageHeader } from '../../../components/PageHeader/PageHeader';
import { TopBar } from '../../../components/navigation/TopBar';
import { DESKTOP_QUERY, useMediaQuery } from '../../../hooks/useMediaQuery';

/**
 * W07-W11 header: the mobile top bar (title, "Step N of 3", back) and, on desktop,
 * the same title as a page header next to the sidebar.
 */
export function FlowHeader({
  title,
  subtitle,
  backTo,
}: {
  title: string;
  subtitle?: string;
  backTo: string;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  return isDesktop ? (
    <PageHeader title={title} subtitle={subtitle} />
  ) : (
    <TopBar title={title} subtitle={subtitle} backTo={backTo} />
  );
}
