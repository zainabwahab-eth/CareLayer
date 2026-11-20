import { useContext } from 'react';
import { ChatContext, type ChatContextValue } from './chat-context';

/** The current assistant chat (W06). Must be used inside <ChatProvider>. */
export function useChat(): ChatContextValue {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error('useChat must be used inside <ChatProvider>');
  return chat;
}
