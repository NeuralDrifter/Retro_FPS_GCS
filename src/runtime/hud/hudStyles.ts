/** Adds the combat HUD's stylesheet to the page once (moved out of CombatHUD.ts in P1.4) */
export function injectCombatHudStyles(): void {
  if (
    typeof document === 'undefined' ||
    document.getElementById('forgecore-runtime-hud-styles')
  ) {
    return;
  }
  const styleEl = document.createElement('style');
  styleEl.id = 'forgecore-runtime-hud-styles';
  styleEl.textContent = `
    .forgecore-combat-hud-root .ide-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 22px;
      padding: 0 8px;
      font-size: 11px;
      font-weight: 500;
      color: #cccccc;
      background-color: #2d2d30;
      border: 1px solid #3e3e42;
      border-radius: 2px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .forgecore-combat-hud-root .ide-btn:hover:not(:disabled) {
      background-color: #3e3e42;
      color: #ffffff;
    }
    .forgecore-combat-hud-root .ide-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .forgecore-combat-hud-root .ide-btn--primary {
      background-color: #0e639c;
      border-color: #1177bb;
      color: #ffffff;
    }
    .forgecore-combat-hud-root .ide-btn--primary:hover:not(:disabled) {
      background-color: #1177bb;
    }
  `;
  document.head.appendChild(styleEl);
}
