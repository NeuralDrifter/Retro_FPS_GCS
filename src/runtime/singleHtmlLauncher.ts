/**
 * ============================================================================
 * SINGLE HTML OFFLINE RUNTIME LAUNCHER (`/src/runtime/singleHtmlLauncher.ts`)
 * ============================================================================
 * Self-contained entry point compiled by esbuild for Single HTML offline export.
 * Inlines Three.js and the ForgeCore runtime into a single self-executing bundle
 * that launches from window.__GRIDFORGE_MANIFEST__.
 */

import { startGame } from './startGame';
import type { GameManifest } from './types';

declare global {
  interface Window {
    __GRIDFORGE_MANIFEST__?: GameManifest;
  }
}

export function launchSingleHtmlGame(): void {
  const container = document.getElementById('game-container');
  const overlay = document.getElementById('click-to-play');
  const manifest = window.__GRIDFORGE_MANIFEST__;

  if (!manifest) {
    console.error('GridForge: window.__GRIDFORGE_MANIFEST__ is not defined.');
    return;
  }

  const game = startGame(manifest, container, {
    hudRoot: container,
    autoLockPointerOnClick: true,
    assetBaseUrl: '',
    dracoDecoderPath: '',
  });

  if (overlay) {
    overlay.addEventListener('click', () => {
      overlay.style.display = 'none';
      game.lockPointer();
    });
  }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => launchSingleHtmlGame());
  } else {
    launchSingleHtmlGame();
  }
}
