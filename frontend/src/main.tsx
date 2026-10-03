import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { AppProviders } from './app/providers';
import { frontendReleaseMetadata } from './services/release-provenance';
import './styles.css';

console.info('Frontend release', frontendReleaseMetadata);

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
