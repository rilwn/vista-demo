import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@vista/ui/styles.css';
import './styles.css';
import './layout/workspace-theme.css';

import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { RouterProvider } from './routing/Router';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Application root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </RouterProvider>
  </StrictMode>,
);
