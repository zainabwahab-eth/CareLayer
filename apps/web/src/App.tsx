import { RouterProvider } from 'react-router';
import { api } from './api';
import { ApiProvider } from './api/ApiProvider';
import { AuthProvider } from './auth/AuthProvider';
import { router } from './routes/router';
import { ThemeProvider } from './theme/ThemeProvider';

export function App() {
  return (
    <ApiProvider api={api}>
      <ThemeProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
