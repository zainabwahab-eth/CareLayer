import { render } from '@testing-library/react';
import { ThemeProvider } from '@web/theme/ThemeProvider';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createMockNurseApi, MOCK_VERIFICATION_CODE } from '../api/mock-api';
import { NurseApiProvider } from '../api/NurseApiProvider';
import type { NurseApi } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { routes } from '../routes/router';

/** A fresh mock API with no delay and no storage. */
export function testApi(): NurseApi {
  return createMockNurseApi({ latencyMs: 0, persist: false });
}

/** Sign in on the mock (sets its session) as an existing or new nurse. */
export async function signIn(api: NurseApi, email: string, name?: string) {
  const purpose = name ? 'signup' : 'login';
  await api.auth.requestCode({ email, purpose, app: 'nurses', name });
  await api.auth.verifyCode({ email, code: MOCK_VERIFICATION_CODE, purpose, app: 'nurses', name });
}

/** Render the whole nurse app at `path`, with the real routes, guards and providers (as App). */
export function renderApp(api: NurseApi, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <NurseApiProvider api={api}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ThemeProvider>
    </NurseApiProvider>,
  );
  return { ...utils, router };
}

/** Bytes that pass the server's (and the mock's) file sniffing. */
export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%mock document\n');
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

export function pdfFile(name = 'licence.pdf') {
  return new File([PDF_BYTES], name, { type: 'application/pdf' });
}
