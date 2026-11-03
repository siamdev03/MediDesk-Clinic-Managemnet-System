import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { LangProvider } from './i18n.jsx';
import { installErrorReporting } from './errorReporter.js';
import './styles.css';

installErrorReporting();

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <LangProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LangProvider>
  </ErrorBoundary>,
);

// Feature 24: PWA – the service worker only runs in the production build (npm run build)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}