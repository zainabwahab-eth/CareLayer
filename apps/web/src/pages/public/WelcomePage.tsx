import { FREE_ANSWERS_PER_WOMAN } from '@carelayer/shared';
import { Link } from 'react-router';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { ButtonAnchor, ButtonLink } from '../../components/Button/Button';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon/Icon';
import type { IconName } from '../../components/Icon/icons';
import { Logo } from '../../components/Logo/Logo';
import { QuickExitButton } from '../../components/QuickExit/QuickExitButton';
import { externalLinks } from '../../routes/external-links';
import { paths } from '../../routes/paths';
import { useTheme } from '../../theme/useTheme';
import dotPattern from '../../assets/landing/dot-pattern.svg';
import styles from './WelcomePage.module.css';

/*
 * W01 landing page (Figma: "Landing — Desktop 1440" and "Landing — Desktop 1440 — Dark").
 * Every colour is a theme token, so the dark frame follows from the dark palette; the
 * toggle in the nav switches it (and is remembered, like Account → Appearance).
 * Desktop is the Figma layout; narrower screens stack the same sections.
 */

const SECTION = {
  howItWorks: 'how-it-works',
  privacy: 'privacy',
  forNurses: 'for-nurses',
  faq: 'faq',
} as const;

const steps = [
  {
    title: 'Ask in your own words',
    text: 'Chat about periods, pregnancy, contraception or sex. Your assistant answers many questions for free.',
  },
  {
    title: 'A verified nurse replies',
    text: 'When you need a professional, you choose to send your question. A verified nurse or midwife answers, and never sees your name or number.',
  },
  {
    title: 'Pay only for answers',
    text: 'Top up from ₦1,000. You’re charged when an answer arrives, never while you wait.',
  },
];

const privacyPoints: ReadonlyArray<{
  icon: IconName;
  /** Icon circle colour (CSS class). */
  tone: 'tonePrimary' | 'toneAccent' | 'toneRose';
  title: string;
  text: string;
}> = [
  {
    icon: 'lock',
    tone: 'tonePrimary',
    title: 'Your name and number stay with us',
    text: 'Nurses only see your question and the details you agree to share.',
  },
  {
    icon: 'eyeOff',
    tone: 'toneAccent',
    title: 'Quick exit, one tap',
    text: 'Leave CareLayer instantly if someone is looking over your shoulder. Esc twice on a laptop.',
  },
  {
    icon: 'user',
    tone: 'toneRose',
    title: 'Choose who answers',
    text: 'Send to the first available nurse, pick one yourself, or ask for female health workers only.',
  },
];

const prices: ReadonlyArray<{ label: string; value: string; large?: boolean }> = [
  { label: 'Chat with the assistant', value: 'Free' },
  { label: `Your first ${FREE_ANSWERS_PER_WOMAN} nurse answers`, value: 'Free' },
  { label: 'Each nurse answer', value: '₦500', large: true },
  { label: 'Top up', value: 'From ₦1,000' },
  { label: 'Spending limit per answer', value: 'You set it' },
  { label: 'No nurse picks it up in 30 minutes', value: 'You pay nothing' },
];

const nurseSteps = [
  {
    title: 'Verify your licence once',
    text: 'Upload your licence and ID. We review it within 1 to 2 working days.',
  },
  {
    title: 'Pick questions you can answer',
    text: 'Choose your topics. Claim a question and you have 10 minutes to reply.',
  },
  {
    title: 'Get paid for each answer',
    text: '₦400 per answer, paid instantly in USDC on Stellar. Withdraw whenever you like.',
  },
];

const faqs = [
  {
    question: 'Who answers my questions?',
    answer:
      'Registered nurses and midwives in Nigeria. We check every licence with the Nursing and Midwifery Council of Nigeria before they can answer, and each reply shows who wrote it.',
  },
  {
    question: 'Is it really anonymous?',
    answer:
      'Yes. Nurses never see your name, email, phone number or location: only your question and the details you agree to share before sending it. Your chats with the assistant are saved to your account so you can come back to them: only you can see them, and you can delete any of them.',
  },
  {
    question: 'What if it’s an emergency?',
    answer:
      'Don’t wait for an answer. If you describe signs of an emergency, CareLayer shows you where to get help straight away, for free, and nothing is sent to a nurse. Call 112, or 767 in Lagos.',
  },
  {
    question: 'How do I pay?',
    answer: `Your first ${FREE_ANSWERS_PER_WOMAN} nurse answers are free. After that, top up your CareLayer balance by card from ₦1,000. Each answer is ₦500, taken only when it reaches you.`,
  },
  {
    question: 'Does this replace seeing a doctor or clinic?',
    answer:
      'No. CareLayer gives health guidance, not a diagnosis. If a nurse thinks you should be seen in person, they will tell you, and you should go to a clinic.',
  },
];

export function WelcomePage() {
  return (
    <div className={styles.page}>
      <Hero />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <HowItWorks />
        <section className={styles.canvasSection} aria-label="Who answers and privacy">
          <WhoAnswersAndPrivacy />
          <Emergencies />
        </section>
        <Pricing />
        <ForNurses />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setPreference } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={styles.themeToggle}
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon name="theme" size={20} />
    </button>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.nav}>
        <Link to={paths.welcome} className={styles.logoLink} aria-label="CareLayer home">
          <Logo tone="inverse" />
        </Link>
        <nav aria-label="Sections" className={styles.navLinks}>
          <a href={`#${SECTION.howItWorks}`}>How it works</a>
          <a href={`#${SECTION.forNurses}`}>For nurses and midwives</a>
          <a href={`#${SECTION.faq}`}>FAQ</a>
        </nav>
        <div className={styles.navActions}>
          <ThemeToggle />
          <QuickExitButton />
          <Link to={paths.logIn} className={styles.logIn}>
            Log in
          </Link>
          <ButtonLink
            to={paths.beforeYouStart}
            variant="secondary"
            tone="inverse"
            className={cx(styles.lightButton, styles.navCta)}
          >
            Ask a question
          </ButtonLink>
        </div>
      </div>

      <div className={styles.heroBody}>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>Ask the question you’ve been holding in.</h1>
          <p className={styles.heroLede}>
            Our assistant answers what it can. When you need a professional, a verified Nigerian
            nurse or midwife replies in private, usually within minutes. You only pay when an answer
            arrives.
          </p>
          <div className={styles.ctaRow}>
            <ButtonLink
              to={paths.beforeYouStart}
              variant="secondary"
              tone="inverse"
              className={styles.lightButton}
            >
              Ask a question
            </ButtonLink>
            <a href={externalLinks.workersApp} className={styles.heroLink}>
              I’m a nurse or midwife
            </a>
          </div>
          <p className={styles.heroNote}>Your first {FREE_ANSWERS_PER_WOMAN} answers are free.</p>
        </div>
        <HeroVisual />
      </div>
    </header>
  );
}

/** Figma "Hero visual": an example conversation. Decorative content, not a live chat. */
function HeroVisual() {
  return (
    <figure className={styles.heroVisual} aria-label="Example: a question answered by a midwife">
      <img src={dotPattern} alt="" className={styles.dotPattern} width={616} height={620} />
      <div className={styles.chatPreview}>
        <div className={styles.chatHeader}>
          <span className={styles.assistantAvatar} aria-hidden>
            <Icon name="sparkle" size={14} />
          </span>
          <span className={styles.chatTitle}>CareLayer assistant</span>
          <span className={styles.chatPrivate}>
            <Icon name="lock" size={14} />
            Private chat
          </span>
        </div>
        <p className={styles.herMessage}>
          I’m 24 weeks pregnant and my feet have been swollen for two days. Should I be worried?
        </p>
        <p className={styles.chatText}>
          Some swelling is common in pregnancy, but this is worth a check from a professional. I can
          send it to a verified midwife anonymously for ₦500.
        </p>
        <p className={styles.chatCaption}>Sent anonymously. Answered in 6 minutes.</p>
        <div className={styles.verifiedAnswer}>
          <div className={styles.answerWho}>
            <Avatar name="Amaka Okafor" size={40} decorative />
            <span className={styles.answerName}>
              <span className={styles.answerNurse}>Amaka Okafor</span>
              <span className={styles.chatCaption}>Registered midwife</span>
            </span>
            <Badge variant="verified">Licence verified</Badge>
          </div>
          <p className={styles.chatText}>
            Mild swelling in the feet is common at this stage. Rest with your feet raised and drink
            plenty of water. Go to a clinic today if your face or hands swell, or you get a bad
            headache or blurred vision.
          </p>
        </div>
      </div>
    </figure>
  );
}

function HowItWorks() {
  return (
    <section
      id={SECTION.howItWorks}
      className={cx(styles.section, styles.surface)}
      aria-labelledby="how-title"
    >
      <h2 id="how-title" className={styles.displayL}>
        How it works
      </h2>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNumber} aria-hidden>
              {index + 1}
            </span>
            <h3 className={styles.titleL}>{step.title}</h3>
            <p className={styles.bodyMuted}>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WhoAnswersAndPrivacy() {
  return (
    <div className={styles.twoColumns}>
      <section className={styles.whoCard} aria-labelledby="who-title">
        <h2 id="who-title" className={styles.displayM}>
          Every answer comes from a licensed professional
        </h2>
        <p className={styles.bodyLMuted}>
          Before anyone can answer, we check their licence with the Nursing and Midwifery Council of
          Nigeria and match their ID to a selfie. Every reply shows the nurse’s name, role and a
          verified badge.
        </p>
        <ul className={styles.roles}>
          <li className={styles.roleChip}>Registered nurses</li>
          <li className={styles.roleChip}>Registered midwives</li>
        </ul>
        <Badge variant="verified">Licence verified</Badge>
      </section>

      <section id={SECTION.privacy} className={styles.privacy} aria-labelledby="privacy-title">
        <h2 id="privacy-title" className={styles.displayM}>
          Private from start to finish
        </h2>
        <ul className={styles.points}>
          {privacyPoints.map((point) => (
            <li key={point.title} className={styles.point}>
              <span className={cx(styles.pointIcon, styles[point.tone])} aria-hidden>
                <Icon name={point.icon} size={22} />
              </span>
              <span className={styles.pointText}>
                <span className={styles.titleM}>{point.title}</span>
                <span className={styles.bodyMuted}>{point.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Emergencies() {
  return (
    <aside className={styles.emergency} aria-labelledby="emergency-title">
      <div className={styles.emergencyTitle}>
        <span className={styles.emergencyIcon} aria-hidden>
          <Icon name="alert" size={26} />
        </span>
        <h2 id="emergency-title" className={styles.emergencyHeading}>
          If it’s an emergency, don’t wait for an answer.
        </h2>
      </div>
      <div className={styles.emergencyText}>
        <p className={styles.bodyL}>
          Heavy bleeding, a severe headache, chest pain or thoughts of harming yourself? CareLayer{' '}
          <Link to={paths.emergency} className={styles.inlineLink}>
            shows you where to get help
          </Link>{' '}
          straight away. It’s free, and nothing is sent to anyone.
        </p>
        <p className={styles.call}>
          <Icon name="phone" size={18} />
          <span>
            Call <a href="tel:112">112</a>, or <a href="tel:767">767</a> in Lagos.
          </span>
        </p>
      </div>
    </aside>
  );
}

function Pricing() {
  return (
    <section className={cx(styles.section, styles.surface)} aria-labelledby="pricing-title">
      <div className={styles.split}>
        <div className={styles.intro}>
          <h2 id="pricing-title" className={styles.displayL}>
            Pay only for answers
          </h2>
          <p className={styles.bodyLMuted}>
            Talking to the assistant is free. Top up a small balance and pay only when a nurse’s
            answer reaches you.
          </p>
        </div>
        <dl className={styles.priceList}>
          {prices.map((price) => (
            <div key={price.label} className={styles.priceRow}>
              <dt className={styles.bodyL}>{price.label}</dt>
              <dd className={cx(styles.priceValue, price.large && styles.priceLarge)}>
                {price.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function ForNurses() {
  return (
    <section
      id={SECTION.forNurses}
      className={cx(styles.section, styles.primary)}
      aria-labelledby="nurses-title"
    >
      <div className={styles.nursesLayout}>
        <div className={styles.nursesCopy}>
          <p className={styles.eyebrow}>For nurses and midwives</p>
          <h2 id="nurses-title" className={cx(styles.displayL, styles.onPrimary)}>
            Earn from what you know, on your own time.
          </h2>
          <p className={styles.onPrimaryMuted}>
            Answer women’s questions between shifts or in the evening. Each answer is paid straight
            to your wallet the moment it’s delivered.
          </p>
          <ButtonAnchor
            href={externalLinks.workersApp}
            variant="secondary"
            tone="inverse"
            className={styles.lightButton}
          >
            Join as a nurse or midwife
          </ButtonAnchor>
        </div>
        <ul className={styles.nurseSteps}>
          {nurseSteps.map((step) => (
            <li key={step.title} className={styles.nurseStep}>
              <h3 className={cx(styles.titleM, styles.onPrimary)}>{step.title}</h3>
              <p className={styles.onPrimaryMutedM}>{step.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section
      id={SECTION.faq}
      className={cx(styles.section, styles.canvas)}
      aria-labelledby="faq-title"
    >
      <div className={styles.split}>
        <h2 id="faq-title" className={cx(styles.displayL, styles.faqTitle)}>
          Questions people ask us
        </h2>
        <div className={styles.faqList}>
          {faqs.map((faq, index) => (
            <details key={faq.question} className={styles.faqItem} open={index === 0}>
              <summary className={styles.faqQuestion}>
                <span>{faq.question}</span>
                <span className={styles.faqSign} aria-hidden />
              </summary>
              <p className={styles.bodyLMuted}>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerTop}>
        <Link to={paths.welcome} className={styles.logoLink} aria-label="CareLayer home">
          <Logo />
        </Link>
        <nav aria-label="Footer" className={styles.footerLinks}>
          <a href={`#${SECTION.howItWorks}`}>How it works</a>
          <a href={`#${SECTION.forNurses}`}>For nurses and midwives</a>
          <a href={`#${SECTION.privacy}`}>Privacy</a>
          <Link to={paths.beforeYouStart}>Terms</Link>
          <a href={`mailto:${externalLinks.contactEmail}`}>Contact</a>
        </nav>
      </div>
      <div className={styles.footerBottom}>
        <p>
          CareLayer gives health guidance. It doesn’t replace seeing a health worker in person.
          Contact: <a href={`mailto:${externalLinks.contactEmail}`}>{externalLinks.contactEmail}</a>
        </p>
        <p>Payments in USDC on Stellar</p>
      </div>
    </footer>
  );
}
