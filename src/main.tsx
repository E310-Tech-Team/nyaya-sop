import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
// Self-hosted fonts (all subsets ship; browsers only download the ones a page needs).
import '@fontsource/anton';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import './index.css';
import App from './App';
import { captureAttribution } from './lib/attribution';
import { startInstallTracking } from './lib/install';
import { registerServiceWorker } from './lib/pwa';

captureAttribution();
// Before the first render, so an early install prompt event isn't missed.
startInstallTracking();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
