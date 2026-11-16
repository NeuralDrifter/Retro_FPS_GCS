import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './editor/App.tsx';
import {AppErrorBoundary} from './editor/components/errors/ErrorBoundary';
import {installGlobalErrorHandlers} from './editor/components/errors/problems';
import {publicFileUrl} from './editor/engine/basePath';
import {EntityLoader, emitDebugEvent} from './runtime';
import './index.css';

// Uncaught errors and rejected promises go to the Problems panel (P6.1); nothing is sent anywhere
installGlobalErrorHandlers();

// Before any model loads: the editor uses the runtime's copy of the Draco decoder (P3.6), under its base path.
EntityLoader.setDracoDecoderPath(publicFileUrl('runtime/draco/'));

/** Announces `gcs:editor-ready` after the editor's first commit, for the e2e suite. */
function EditorReadySignal() {
  useEffect(() => emitDebugEvent('editor-ready'), []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
    <EditorReadySignal />
  </AppErrorBoundary>
);
