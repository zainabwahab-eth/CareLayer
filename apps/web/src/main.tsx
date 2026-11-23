import '@carelayer/tokens/tokens.css';
import './styles/global.css';
import './styles/typography.css';
// Must stay above ./App (see boot.ts).
import './boot';
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
