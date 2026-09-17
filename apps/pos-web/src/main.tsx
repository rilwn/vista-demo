import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@vista/ui/styles.css';

import './styles.css';

import { App } from './App';
import { LocalizationProvider } from './i18n/LocalizationProvider';
import { TranslationBoundary } from './i18n/TranslationBoundary';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Application root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <LocalizationProvider>
      <TranslationBoundary>
        <App />
      </TranslationBoundary>
    </LocalizationProvider>
  </StrictMode>,
);
