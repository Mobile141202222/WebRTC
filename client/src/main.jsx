import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { registerApplicationServiceWorker } from './lib/pushNotifications.js';

void registerApplicationServiceWorker().catch(() => {
  // Ignore service worker registration failures in unsupported browsers.
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
