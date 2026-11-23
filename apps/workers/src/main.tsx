import '@carelayer/tokens/tokens.css';
// The design system's base styles, shared with apps/web.
import '@web/styles/global.css';
import '@web/styles/typography.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
