import { Outlet } from 'react-router';
import styles from './StandaloneLayout.module.css';

/*
 * Full-screen pages with their own top area and no app navigation:
 * W13 Emergency, Not found. (W01 Welcome is full-bleed and has its own layout.)
 */
export function StandaloneLayout() {
  return (
    <main id="main-content" tabIndex={-1} className={styles.main}>
      <div className={styles.content}>
        <Outlet />
      </div>
    </main>
  );
}
