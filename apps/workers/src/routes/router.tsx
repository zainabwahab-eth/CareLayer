import { createBrowserRouter, type RouteObject } from 'react-router';
import { NurseAuthLayout } from '../layouts/NurseAuthLayout';
import { RootLayout } from '../layouts/RootLayout';
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
 * N04 while she waits or after a rejection; Today once approved.
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
              {
                element: <RequireStatus allow={['approved']} />,
                children: [{ path: paths.today, Component: TodayPage }],
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
