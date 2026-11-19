import { Outlet } from 'react-router';
import { Icon } from '../components/Icon/Icon';
import type { IconName } from '../components/Icon/icons';
import { Logo } from '../components/Logo/Logo';
import styles from './AuthLayout.module.css';

const points: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'lock', text: 'Anonymous by default' },
  { icon: 'shield', text: 'Verified professionals only' },
  { icon: 'alert', text: 'Emergencies never wait' },
];

/*
 * Onboarding / auth shell (W02 Before you start, W03 Sign up, W04 Verify email, Log in).
 *   Mobile: single column.
 *   Desktop: Figma "Auth panel/Women" (deep teal, 600px) on the left, content on the right.
 */
export function AuthLayout() {
  return (
    <div className={styles.shell}>
      <aside className={styles.panel} aria-label="About CareLayer">
        <Logo tone="inverse" />
        <div className={styles.illustration} aria-hidden>
          <span className={styles.layerSoft} />
          <span className={styles.layerAccent} />
          <span className={styles.layerRose} />
          <span className={styles.layerSurface}>
            <Icon name="shield" size={60} />
          </span>
        </div>
        <div className={styles.copy}>
          <p className={styles.headline}>Ask what you’ve been holding in.</p>
          <p className={styles.lede}>
            Private answers from verified Nigerian nurses and midwives, whenever your assistant
            needs a professional.
          </p>
          <ul role="list" className={styles.points}>
            {points.map((point) => (
              <li key={point.text} className={styles.point}>
                <Icon name={point.icon} size={20} className={styles.pointIcon} />
                {point.text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
