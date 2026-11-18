import { Outlet } from 'react-router';
import styles from './StandaloneLayout.module.css';

/*
 * Full-screen pages with their own top area and no app navigation:
 * W01 Welcome, W13 Emergency, Not found.
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
