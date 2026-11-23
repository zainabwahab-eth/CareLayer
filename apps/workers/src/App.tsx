import { ThemeProvider } from '@web/theme/ThemeProvider';
import { RouterProvider } from 'react-router';
import { api } from './api';
import { NurseApiProvider } from './api/NurseApiProvider';
import { AuthProvider } from './auth/AuthProvider';
import { router } from './routes/router';

export function App() {
  return (
    <NurseApiProvider api={api}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ThemeProvider>
    </NurseApiProvider>
  );
}
