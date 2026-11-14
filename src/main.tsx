import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {emitDebugEvent} from './runtime/debugEvents';
import './index.css';

/** Announces `gcs:editor-ready` after the editor's first commit, for the e2e suite. */
function EditorReadySignal() {
  useEffect(() => emitDebugEvent('editor-ready'), []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <EditorReadySignal />
  </>
);
