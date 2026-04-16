import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { validateApiConfiguration } from './utils/constants.js';
import { migrateLegacyKeys } from './utils/storageKeys.js';
import './index.css';
import './preload.js'; // Preload WASM components for faster loading

// Tauri v2 environment detection (cleaned up)
console.log('🚀 OpenSubtitles Uploader - Starting app initialization');
console.log('🔍 Protocol:', window.location.protocol);

// Tauri environment detection
const isTauriEnvironment = window.location.protocol === 'tauri:';

if (isTauriEnvironment) {
  console.log(
    '🔧 Tauri v2 environment detected - drag and drop should work with dragDropEnabled: false'
  );
} else {
  console.log('🌐 Browser environment detected');
}

// One-shot purge of legacy .org localStorage keys (PHPSESSID, XML-RPC caches).
// Idempotent — sets a marker after first run so subsequent launches no-op.
// MUST run before any service module reads from localStorage.
if (migrateLegacyKeys()) {
  console.log('🧹 Migrated legacy localStorage keys to .com REST shape');
}

// Validate API configuration on startup
validateApiConfiguration();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
