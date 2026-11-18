import { createContext } from 'react';

/** What the user picked in Appearance. "system" follows prefers-color-scheme. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** The theme actually on screen right now. */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const THEME_STORAGE_KEY = 'carelayer.theme';

export const ThemeContext = createContext<ThemeContextValue | null>(null);
