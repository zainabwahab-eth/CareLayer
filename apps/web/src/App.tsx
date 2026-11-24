import { RouterProvider } from 'react-router';
import { api } from './api';
import { ApiProvider } from './api/ApiProvider';
import { AuthProvider } from './auth/AuthProvider';
import { ChatProvider } from './chat/ChatProvider';
import { router } from './routes/router';
import { ThemeProvider } from './theme/ThemeProvider';

export function App() {
  return (
    <ApiProvider api={api}>
      <ThemeProvider>
        <AuthProvider>
          <ChatProvider>
            <RouterProvider router={router} />
          </ChatProvider>
        </AuthProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
