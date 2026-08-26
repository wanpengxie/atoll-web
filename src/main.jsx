import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { diagnostic, installGlobalDiagnostics } from './model/diagnostics.js';
import './styles.css';

installGlobalDiagnostics();
diagnostic('info', 'app.boot', { href: window.location.href, userAgent: navigator.userAgent });

createRoot(document.getElementById('root'), {
  onUncaughtError: (error, info) => diagnostic('error', 'react.uncaught', { error, componentStack: info?.componentStack || '' }),
  onCaughtError: (error, info) => diagnostic('error', 'react.caught', { error, componentStack: info?.componentStack || '' }),
  onRecoverableError: (error, info) => diagnostic('warn', 'react.recoverable', { error, componentStack: info?.componentStack || '' }),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
