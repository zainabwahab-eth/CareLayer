import { paths } from '../../routes/paths';
import type { IconName } from '../Icon/icons';

/** The primary destinations, shared by the mobile tab bar and desktop sidebar. */
export type NavKey = 'home' | 'ask' | 'consultations' | 'history' | 'account';

export interface NavItem {
  key: NavKey;
  label: string;
  to: string;
  icon: IconName;
}

export const navItems: readonly NavItem[] = [
  { key: 'home', label: 'Home', to: paths.home, icon: 'home' },
  { key: 'ask', label: 'Ask', to: paths.ask, icon: 'chat' },
  // Questions sent to nurses, with answers and receipts (W12).
  { key: 'consultations', label: 'Consultations', to: paths.consultations, icon: 'shield' },
  // Saved chats with the assistant.
  { key: 'history', label: 'History', to: paths.history, icon: 'clock' },
  { key: 'account', label: 'Account', to: paths.account, icon: 'user' },
];
