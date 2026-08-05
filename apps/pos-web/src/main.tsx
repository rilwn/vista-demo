import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@vista/ui/styles.css';

import { App } from './App';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Application root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
