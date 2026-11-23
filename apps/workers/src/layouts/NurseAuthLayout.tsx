import { Icon } from '@web/components/Icon/Icon';
import type { IconName } from '@web/components/Icon/icons';
import { Logo } from '@web/components/Logo/Logo';
import styles from '@web/layouts/AuthLayout.module.css';
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';

const points: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'clock', text: 'Answer between shifts' },
  { icon: 'wallet', text: '₦400 per answer, paid instantly' },
  { icon: 'heart', text: 'Help women who have nowhere else to ask' },
];

/*
 * Figma "Auth panel/Nurse" (D-N01-D-N04): the women's AuthLayout structure and
 * styles with the nurse copy. Mobile: single column. Desktop (960px+): the deep
 * teal 600px panel on the left, the page on the right.
 */
export function NurseAuthLayout({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.panel} aria-label="About CareLayer for health workers">
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
          <p className={styles.headline}>Your expertise, on your own time.</p>
          <p className={styles.lede}>
            Answer women’s health questions from AI assistants across Nigeria and get paid the
            moment each answer is delivered.
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
        <div className={styles.content}>{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
