import { RouterProvider } from 'react-router';
import { api } from './api';
import { SendFlowProvider } from './ask-nurse/SendFlowProvider';
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
            <SendFlowProvider>
              <RouterProvider router={router} />
            </SendFlowProvider>
          </ChatProvider>
        </AuthProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
