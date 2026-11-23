import { paths } from '../routes/paths';

export type WorkspaceNavKey =
  'today' | 'available' | 'mine' | 'earnings' | 'updates' | 'profile' | 'settings';

/** Which section the current URL belongs to. */
export function activeSection(pathname: string, search: string): WorkspaceNavKey {
  if (pathname.startsWith(paths.cases)) {
    const tab = new URLSearchParams(search).get('tab');
    return tab === 'active' || tab === 'completed' ? 'mine' : 'available';
  }
  if (pathname.startsWith(paths.earnings)) return 'earnings';
  if (pathname.startsWith(paths.updates)) return 'updates';
  if (pathname.startsWith(paths.profile)) return 'profile';
  if (pathname.startsWith(paths.settings)) return 'settings';
  return 'today';
}
