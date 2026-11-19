import { Link } from 'react-router';
import { ButtonLink } from '../../components/Button/Button';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { Logo } from '../../components/Logo/Logo';
import { externalLinks } from '../../routes/external-links';
import { paths } from '../../routes/paths';
import styles from './WelcomePage.module.css';

/*
 * W01 Welcome, the landing page (Figma: "W01 Welcome", "W01 Welcome — Dark", "D-W01 Welcome").
 *   Mobile: illustration, headline, then full-width stacked actions at the bottom.
 *   Tablet: same column, centred, plus the top nav and promises.
 *   Desktop: top nav, copy on the left, illustration on the right.
 */

const promises: ReadonlyArray<{ icon: IconName; text: string }> = [
  { icon: 'lock', text: 'Anonymous by default' },
  { icon: 'shield', text: 'Verified professionals' },
  { icon: 'alert', text: 'Emergencies never wait' },
];

export function WelcomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.topNav}>
        <Logo tone="inverse" />
        <nav aria-label="Account" className={styles.navLinks}>
          <a href={externalLinks.workersApp} className={styles.navLinkMuted}>
            For nurses and midwives
          </a>
          <Link to={paths.logIn} className={styles.navLink}>
            Log in
          </Link>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.headline}>Ask what you’ve been holding in.</h1>
          <p className={styles.lede}>
            Private answers from verified Nigerian nurses and midwives, whenever your assistant
            needs a professional.
          </p>
          <ul role="list" className={styles.promises}>
            {promises.map((promise) => (
              <li key={promise.text} className={styles.promise}>
                <Icon name={promise.icon} size={18} className={styles.promiseIcon} />
                {promise.text}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <ButtonLink to={paths.beforeYouStart} variant="secondary" tone="inverse">
              Get started<span className={styles.desktopOnly}>, it’s free</span>
            </ButtonLink>
            <ButtonLink to={paths.logIn} variant="ghost" tone="inverse">
              I already have an account
            </ButtonLink>
          </div>
        </div>

        {/* Figma "Illustration / Layers": decorative. */}
        <div className={styles.illustration} aria-hidden>
          <div className={styles.stage}>
            <span className={styles.layerSoft} />
            <span className={styles.layerAccent} />
            <span className={styles.layerRose} />
            <span className={styles.layerSurface}>
              <Icon name="shield" size={56} className={styles.shieldMobile} />
              <Icon name="shield" size={84} className={styles.shieldDesktop} />
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
