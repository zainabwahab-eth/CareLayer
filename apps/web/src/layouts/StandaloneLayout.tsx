import { Outlet } from 'react-router';
import styles from './StandaloneLayout.module.css';

/*
 * Full-screen pages with their own top area and no app navigation: Not found.
 * (W01 Welcome and W13 Emergency are full-bleed and render their own <main>.)
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
