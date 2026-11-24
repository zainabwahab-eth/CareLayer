import alert18 from '../../assets/icons/alert-18.svg';
import alert20 from '../../assets/icons/alert-20.svg';
import alert22 from '../../assets/icons/alert-22.svg';
import alert32 from '../../assets/icons/alert-32.svg';
import alert36 from '../../assets/icons/alert-36.svg';
import alert from '../../assets/icons/alert.svg';
import back from '../../assets/icons/back.svg';
import camera20 from '../../assets/icons/camera-20.svg';
import bell from '../../assets/icons/bell.svg';
import check16 from '../../assets/icons/check-16.svg';
import chevron18 from '../../assets/icons/chevron-18.svg';
import chat from '../../assets/icons/chat.svg';
import clock from '../../assets/icons/clock.svg';
import edit14 from '../../assets/icons/edit-14.svg';
import eyeOff22 from '../../assets/icons/eye-off-22.svg';
import heart22 from '../../assets/icons/heart-22.svg';
import eyeOff from '../../assets/icons/eye-off.svg';
import home from '../../assets/icons/home.svg';
import lock18 from '../../assets/icons/lock-18.svg';
import lock22 from '../../assets/icons/lock-22.svg';
import lock from '../../assets/icons/lock.svg';
import phone18 from '../../assets/icons/phone-18.svg';
import more20 from '../../assets/icons/more-20.svg';
import mail30 from '../../assets/icons/mail-30.svg';
import receipt20 from '../../assets/icons/receipt-20.svg';
import search18 from '../../assets/icons/search-18.svg';
import send20 from '../../assets/icons/send-20.svg';
import shield18 from '../../assets/icons/shield-18.svg';
import shield20 from '../../assets/icons/shield-20.svg';
import shield22 from '../../assets/icons/shield-22.svg';
import shield56 from '../../assets/icons/shield-56.svg';
import shield60 from '../../assets/icons/shield-60.svg';
import shield84 from '../../assets/icons/shield-84.svg';
import shield from '../../assets/icons/shield.svg';
import theme20 from '../../assets/icons/theme-20.svg';
import sparkle16 from '../../assets/icons/sparkle-16.svg';
import sparkle20 from '../../assets/icons/sparkle-20.svg';
import upload20 from '../../assets/icons/upload-20.svg';
import user from '../../assets/icons/user.svg';
import wallet22 from '../../assets/icons/wallet-22.svg';
import zap20 from '../../assets/icons/zap-20.svg';

/*
 * Icons exported from the Figma design system (icon/* layers).
 *
 * Figma exports each icon as just its stroked glyph, positioned inside a
 * square frame. `frame` is that frame's size and x/y/w/h is where the glyph
 * sits in it, so the icon renders with exactly the same optical placement
 * as in Figma at any size. The SVG files are used unmodified; Icon paints
 * them with `currentColor` via CSS mask so they follow the theme.
 *
 * Figma keeps a 1.75px stroke at every icon size, so where the design uses
 * an icon at very different sizes there is one export per size and Icon
 * picks the one whose frame is closest to the requested size.
 */
export interface IconDefinition {
  src: string;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const icons = {
  home: { src: home, frame: 24, x: 3.125, y: 3.125, w: 17.75, h: 17.75 },
  chat: { src: chat, frame: 24, x: 2.625, y: 4.625, w: 18.75, h: 16.75 },
  clock: { src: clock, frame: 24, x: 2.625, y: 2.625, w: 18.75, h: 18.75 },
  user: { src: user, frame: 24, x: 3.625, y: 3.875, w: 16.75, h: 17 },
  bell: { src: bell, frame: 24, x: 4.125, y: 4.625, w: 15.75, h: 16.25 },
  back: { src: back, frame: 24, x: 7.625, y: 5.125, w: 7.75, h: 13.75 },
  check: { src: check16, frame: 16, x: 2.458, y: 4.125, w: 11.083, h: 8.083 },
  chevron: { src: chevron18, frame: 18, x: 6.25, y: 3.625, w: 6.25, h: 10.75 },
  search: { src: search18, frame: 18, x: 2.5, y: 2.5, w: 13.375, h: 13.375 },
  mail: { src: mail30, frame: 30, x: 3.5, y: 6, w: 23, h: 18 },
  send: { src: send20, frame: 20, x: 4.125, y: 3.708, w: 11.75, h: 13 },
  // Nurse app (N01 benefits, N03 uploads).
  wallet: { src: wallet22, frame: 22, x: 2.333, y: 4.625, w: 17.333, h: 13.667 },
  heart: { src: heart22, frame: 22, x: 3.708, y: 4.667, w: 14.583, h: 14.083 },
  upload: { src: upload20, frame: 20, x: 2.875, y: 2.875, w: 14.25, h: 14.667 },
  camera: { src: camera20, frame: 20, x: 2.042, y: 2.875, w: 15.917, h: 13.833 },
  // Landing page (theme toggle, emergency call line).
  theme: { src: theme20, frame: 20, x: 0, y: 0, w: 20, h: 20 },
  // Overflow menu ("⋯"). Not in the Figma icon set: three dots in the same 20px frame.
  more: { src: more20, frame: 20, x: 0, y: 0, w: 20, h: 20 },
  phone: { src: phone18, frame: 18, x: 2.5, y: 2.125, w: 13.375, h: 13.375 },
  sparkle: [
    { src: sparkle16, frame: 16, x: 2.792, y: 1.792, w: 10.417, h: 10.417 },
    { src: sparkle20, frame: 20, x: 3.708, y: 2.458, w: 12.583, h: 12.583 },
  ],
  eyeOff: [
    { src: eyeOff, frame: 18, x: 1.75, y: 2.5, w: 14.5, h: 13 },
    { src: eyeOff22, frame: 22, x: 2.333, y: 3.25, w: 17.334, h: 15.5 },
  ],
  lock: [
    { src: lock18, frame: 18, x: 2.875, y: 2.125, w: 12.25, h: 13.75 },
    { src: lock, frame: 20, x: 3.29, y: 2.458, w: 13.417, h: 15.083 },
    { src: lock22, frame: 22, x: 3.708, y: 2.792, w: 14.583, h: 16.417 },
  ],
  shield: [
    { src: shield, frame: 14, x: 2.042, y: 1.167, w: 9.917, h: 11.667 },
    { src: shield18, frame: 18, x: 2.875, y: 1.75, w: 12.25, h: 14.5 },
    { src: shield20, frame: 20, x: 3.29, y: 2.042, w: 13.417, h: 15.917 },
    { src: shield22, frame: 22, x: 3.708, y: 2.333, w: 14.583, h: 17.333 },
    { src: shield56, frame: 56, x: 10.792, y: 7.292, w: 34.417, h: 41.417 },
    { src: shield60, frame: 60, x: 11.625, y: 7.875, w: 36.75, h: 44.25 },
    { src: shield84, frame: 84, x: 16.625, y: 11.375, w: 50.75, h: 61.25 },
  ],
  alert: [
    { src: alert, frame: 14, x: 0.875, y: 1.458, w: 12.25, h: 10.792 },
    { src: alert18, frame: 18, x: 1.375, y: 2.125, w: 15.25, h: 13.375 },
    { src: alert20, frame: 20, x: 1.625, y: 2.458, w: 16.75, h: 14.667 },
    { src: alert22, frame: 22, x: 1.875, y: 2.792, w: 18.25, h: 15.958 },
    { src: alert32, frame: 32, x: 3.125, y: 4.458, w: 25.75, h: 22.417 },
    { src: alert36, frame: 36, x: 3.625, y: 5.125, w: 28.75, h: 25 },
  ],
} satisfies Record<string, IconDefinition | readonly IconDefinition[]>;

export type IconName = keyof typeof icons;

/** The export to use for a given name and size (closest Figma frame size). */
export function resolveIcon(name: IconName, size?: number): IconDefinition {
  const entry: IconDefinition | readonly IconDefinition[] = icons[name];
  if (!Array.isArray(entry)) return entry as IconDefinition;
  const variants = entry as readonly IconDefinition[];
  const target = size ?? variants[0]!.frame;
  return variants.reduce((best, candidate) =>
    Math.abs(candidate.frame - target) < Math.abs(best.frame - target) ? candidate : best,
  );
}
