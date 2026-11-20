import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from '../layouts/AppLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { RootLayout } from '../layouts/RootLayout';
import { StandaloneLayout } from '../layouts/StandaloneLayout';
import { AccountPage } from '../pages/app/AccountPage';
import { AskPage } from '../pages/app/AskPage';
import { ChooseAnswererPage } from '../pages/app/ChooseAnswererPage';
import { ConfirmPayPage } from '../pages/app/ConfirmPayPage';
import { ConsentPage } from '../pages/app/ConsentPage';
import { HistoryPage } from '../pages/app/HistoryPage';
import { HomePage } from '../pages/app/HomePage';
import { NurseResponsePage } from '../pages/app/NurseResponsePage';
import { WaitingPage } from '../pages/app/WaitingPage';
import { WalletPage } from '../pages/app/WalletPage';
import { EmergencyPage } from '../pages/EmergencyPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { BeforeYouStartPage } from '../pages/public/BeforeYouStartPage';
import { LogInPage } from '../pages/public/LogInPage';
import { SignUpPage } from '../pages/public/SignUpPage';
import { VerifyEmailPage } from '../pages/public/VerifyEmailPage';
import { WelcomePage } from '../pages/public/WelcomePage';
import { GuestOnly } from './GuestOnly';
import { paths } from './paths';
import { RequireAuth } from './RequireAuth';
import type { RouteHandle } from './route-handle';

const handle = (value: RouteHandle) => value;

/* Dev-only component gallery: lazy so it is never in the production bundle. */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: paths.components,
        lazy: async () => ({
          Component: (await import('../pages/dev/ComponentsPage')).ComponentsPage,
        }),
      },
    ]
  : [];

export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    children: [
      // Public: W01 landing page. Full-bleed, renders its own header and <main>.
      { path: paths.welcome, Component: WelcomePage },

      // Public: W13 emergency. Full-bleed emergency background, renders its own <main>.
      // Never behind sign-in: emergencies are free and never queued.
      { path: paths.emergency, Component: EmergencyPage },

      // Public: full-screen pages (not found, dev gallery)
      {
        Component: StandaloneLayout,
        children: [...devRoutes, { path: '*', Component: NotFoundPage }],
      },

      // Public: onboarding / auth (W02-W04 + Log in). Signed-in visitors are sent on.
      {
        Component: GuestOnly,
        children: [
          {
            Component: AuthLayout,
            children: [
              { path: paths.beforeYouStart, Component: BeforeYouStartPage },
              { path: paths.signUp, Component: SignUpPage },
              { path: paths.verifyEmail, Component: VerifyEmailPage },
              { path: paths.logIn, Component: LogInPage },
            ],
          },
        ],
      },

      // Authenticated app (W05-W12, Account, Wallet)
      {
        Component: RequireAuth,
        children: [
          {
            Component: AppLayout,
            children: [
              {
                path: paths.home,
                Component: HomePage,
                handle: handle({ nav: 'home', tabBar: true }),
              },
              {
                path: paths.ask,
                Component: AskPage,
                handle: handle({ nav: 'ask', fullBleed: true }),
              },
              { path: paths.askConsent, Component: ConsentPage, handle: handle({ nav: 'ask' }) },
              {
                path: paths.askChoose,
                Component: ChooseAnswererPage,
                handle: handle({ nav: 'ask' }),
              },
              { path: paths.askConfirm, Component: ConfirmPayPage, handle: handle({ nav: 'ask' }) },
              {
                path: paths.consultationWaiting,
                Component: WaitingPage,
                handle: handle({ nav: 'history' }),
              },
              {
                path: paths.consultation,
                Component: NurseResponsePage,
                handle: handle({ nav: 'history' }),
              },
              {
                path: paths.history,
                Component: HistoryPage,
                handle: handle({ nav: 'history', tabBar: true }),
              },
              {
                path: paths.account,
                Component: AccountPage,
                handle: handle({ nav: 'account', tabBar: true }),
              },
              // Sub-screen of Account (top bar with Back on mobile). Paystack returns here.
              { path: paths.wallet, Component: WalletPage, handle: handle({ nav: 'account' }) },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
