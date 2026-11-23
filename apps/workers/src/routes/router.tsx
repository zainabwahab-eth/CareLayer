import { createBrowserRouter, type RouteObject } from 'react-router';
import { NurseAuthLayout } from '../layouts/NurseAuthLayout';
import { RootLayout } from '../layouts/RootLayout';
import { WorkspaceLayout } from '../layouts/WorkspaceLayout';
import { AnswerSentPage } from '../pages/AnswerSentPage';
import { CasePage } from '../pages/CasePage';
import { CasesPage } from '../pages/CasesPage';
import { EarningsPage } from '../pages/EarningsPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SettingsPage } from '../pages/SettingsPage';
import { UpdatesPage } from '../pages/UpdatesPage';
import { WithdrawalsPage } from '../pages/WithdrawalsPage';
import { WithdrawPage } from '../pages/WithdrawPage';
import { JoinPage } from '../pages/auth/JoinPage';
import { LogInPage } from '../pages/auth/LogInPage';
import { SignUpPage } from '../pages/auth/SignUpPage';
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DocumentsPage } from '../pages/onboarding/DocumentsPage';
import { LicencePage } from '../pages/onboarding/LicencePage';
import { ReviewPage } from '../pages/onboarding/ReviewPage';
import { SubmitPage } from '../pages/onboarding/SubmitPage';
import { TodayPage } from '../pages/TodayPage';
import { GuestOnly, RequireAuth, RequireStatus, StartRedirect } from './guards';
import { paths } from './paths';

/*
 * Statuses (contract §10): draft -> pending_review -> approved | rejected.
 * The steps are open while she can still change things (draft, rejected);
 * N04 while she waits or after a rejection; the workspace (H11) once approved.
 * The API enforces the same rule (403 NURSE_NOT_APPROVED on /nurse/questions*).
 */
export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    children: [
      // Public: N01 Join, sign up, log in, verify. Signed-in nurses are sent on.
      {
        Component: GuestOnly,
        children: [
          { path: paths.join, Component: JoinPage },
          { path: paths.signUp, Component: SignUpPage },
          { path: paths.logIn, Component: LogInPage },
          { path: paths.verifyEmail, Component: VerifyEmailPage },
        ],
      },
      // Signed in: her profile is loaded for everything below.
      {
        Component: RequireAuth,
        children: [
          {
            Component: NurseAuthLayout,
            children: [
              { path: paths.start, Component: StartRedirect },
              {
                element: <RequireStatus allow={['draft', 'rejected']} />,
                children: [
                  { path: paths.licence, Component: LicencePage },
                  { path: paths.documents, Component: DocumentsPage },
                  { path: paths.submit, Component: SubmitPage },
                ],
              },
              {
                element: <RequireStatus allow={['pending_review', 'rejected']} />,
                children: [{ path: paths.review, Component: ReviewPage }],
              },
            ],
          },
          // Approved: the workspace, with its own navigation (WorkspaceLayout).
          {
            element: <RequireStatus allow={['approved']} />,
            children: [
              {
                Component: WorkspaceLayout,
                children: [
                  { path: paths.today, Component: TodayPage },
                  { path: paths.cases, Component: CasesPage },
                  { path: paths.case, Component: CasePage },
                  { path: paths.caseSent, Component: AnswerSentPage },
                  { path: paths.earnings, Component: EarningsPage },
                  { path: paths.withdraw, Component: WithdrawPage },
                  { path: paths.withdrawals, Component: WithdrawalsPage },
                  { path: paths.updates, Component: UpdatesPage },
                  { path: paths.profile, Component: ProfilePage },
                  { path: paths.settings, Component: SettingsPage },
                ],
              },
            ],
          },
        ],
      },
      {
        Component: NurseAuthLayout,
        children: [{ path: '*', Component: NotFoundPage }],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
