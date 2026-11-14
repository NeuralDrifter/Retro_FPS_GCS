import {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {publicFileUrl} from './engine/basePath';
import {emitDebugEvent} from './runtime/debugEvents';
import {EntityLoader} from './runtime/EntityLoader';
import './index.css';

// Before any model loads: the Draco decoder ships in public/draco/ under the editor's base path.
EntityLoader.setDracoDecoderPath(publicFileUrl('draco/'));

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
