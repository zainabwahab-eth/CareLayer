import { RouterProvider } from 'react-router';
import { api } from './api';
import { ApiProvider } from './api/ApiProvider';
import { router } from './routes/router';
import { ThemeProvider } from './theme/ThemeProvider';

export function App() {
  return (
    <ApiProvider api={api}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </ApiProvider>
  );
}
