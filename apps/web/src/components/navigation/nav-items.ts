import { paths } from '../../routes/paths';
import type { IconName } from '../Icon/icons';

/** The four primary destinations, shared by the mobile tab bar and desktop sidebar. */
export type NavKey = 'home' | 'ask' | 'history' | 'account';

export interface NavItem {
  key: NavKey;
  label: string;
  to: string;
  icon: IconName;
}

export const navItems: readonly NavItem[] = [
  { key: 'home', label: 'Home', to: paths.home, icon: 'home' },
  { key: 'ask', label: 'Ask', to: paths.ask, icon: 'chat' },
  { key: 'history', label: 'History', to: paths.history, icon: 'clock' },
  { key: 'account', label: 'Account', to: paths.account, icon: 'user' },
];
