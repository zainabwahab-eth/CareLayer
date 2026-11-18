import { useState, type ReactNode } from 'react';
import { Avatar } from '../../components/Avatar/Avatar';
import { Badge } from '../../components/Badge/Badge';
import { Button } from '../../components/Button/Button';
import { Chip } from '../../components/Chip/Chip';
import { Icon } from '../../components/Icon/Icon';
import { icons, type IconName } from '../../components/Icon/icons';
import { IconButton } from '../../components/IconButton/IconButton';
import { Input } from '../../components/Input/Input';
import { Logo } from '../../components/Logo/Logo';
import { TabBar } from '../../components/navigation/TabBar';
import { TopBar } from '../../components/navigation/TopBar';
import { QuickExitButton } from '../../components/QuickExit/QuickExitButton';
import { ThemeSwitcher } from '../../components/ThemeSwitcher/ThemeSwitcher';
import { Toggle } from '../../components/Toggle/Toggle';
import { paths } from '../../routes/paths';
import styles from './ComponentsPage.module.css';

const categories = ['All', 'Pregnancy', 'Periods', 'Contraception', 'Sexual health', 'General'];

/**
 * Development-only gallery of the component library, mirroring
 * Figma "Design system > Components". Not routed in production builds.
 */
export function ComponentsPage() {
  const [category, setCategory] = useState('All');
  const [notifications, setNotifications] = useState(true);
  const [askBeforePaying, setAskBeforePaying] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo />
        <h1 className="t-display-m">Component library</h1>
        <p className="t-body-m t-muted">
          Mirrors Figma “Design system &gt; Components”. Switch theme to check both palettes.
        </p>
        <ThemeSwitcher />
      </header>

      <Group title="Buttons">
        <Button>Continue</Button>
        <Button variant="secondary">Continue with Google</Button>
        <Button variant="ghost">Not now</Button>
        <Button variant="emergency">Call 112</Button>
        <Button leadingIcon={<Icon name="lock" size={18} />}>Confirm and send</Button>
        <Button disabled>Disabled</Button>
      </Group>

      <Group title="Badges">
        <Badge variant="verified">Licence verified</Badge>
        <Badge variant="emergency">Emergency</Badge>
        <Badge variant="neutral">Pregnancy</Badge>
        <Badge variant="accent">Reviewing</Badge>
        <Badge variant="primary">Answered</Badge>
      </Group>

      <Group title="Chips">
        {categories.map((name) => (
          <Chip key={name} selected={category === name} onClick={() => setCategory(name)}>
            {name}
          </Chip>
        ))}
      </Group>

      <Group title="Input" column>
        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
        />
        <Input
          label="What should we call you?"
          placeholder="A first name or nickname"
          hint="Nurses never see your name."
        />
        <Input
          label="Email code"
          defaultValue="12345"
          error="That code has expired. We sent a new one."
        />
      </Group>

      <Group title="Avatar and toggles">
        <Avatar name="Amaka Okafor" />
        <Avatar name="Tolu" size={36} />
        <Toggle
          checked={notifications}
          onCheckedChange={setNotifications}
          aria-label="Notifications"
        />
        <Toggle
          checked={!notifications}
          onCheckedChange={(on) => setNotifications(!on)}
          aria-label="Quiet mode"
        />
      </Group>

      <Group title="Toggle with label" column>
        <Toggle
          label="Ask me before each payment"
          description="Your assistant checks with you before paying a nurse."
          checked={askBeforePaying}
          onCheckedChange={setAskBeforePaying}
        />
      </Group>

      <Group title="Icons">
        {(Object.keys(icons) as IconName[]).map((name) => (
          <span key={name} className={styles.iconCell}>
            <Icon name={name} size={24} />
            <span className="t-caption t-muted">{name}</span>
          </span>
        ))}
        <IconButton icon="bell" label="Notifications" />
      </Group>

      <Group title="Quick exit">
        <QuickExitButton />
        <div className={styles.narrow}>
          <QuickExitButton variant="block" />
        </div>
      </Group>

      <Group title="Top bar" column>
        <div className={styles.frame}>
          <TopBar title="Send to a nurse" subtitle="Step 1 of 3" backTo={paths.components} />
        </div>
      </Group>

      <Group title="Tab bar (static preview)" column>
        <div className={styles.tabBarPreview}>
          <TabBar active="home" />
        </div>
      </Group>
    </div>
  );
}

function Group({
  title,
  column = false,
  children,
}: {
  title: string;
  column?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={styles.group} aria-label={title}>
      <h2 className="t-title-m">{title}</h2>
      <div className={column ? styles.column : styles.row}>{children}</div>
    </section>
  );
}
