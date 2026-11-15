/**
 * The screen an exported game shows while it loads, and the one it shows when it cannot start
 * (release plan P3.1). Text goes in with `textContent` only, so nothing from a game file can
 * become markup.
 */

export interface BootScreen {
  /** `fraction` is 0 to 1, or null while the total is unknown */
  progress(label: string, fraction: number | null): void;
  error(title: string, detail: string): void;
  hide(): void;
}

export function createBootScreen(root: HTMLElement, gameTitle = ''): BootScreen {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  panel.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
    'background:#0b0b10;color:#d4d4d4;font:14px system-ui,sans-serif;z-index:10;text-align:center;padding:16px';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:20px;font-weight:600;color:#fff';
  title.textContent = gameTitle;
  const label = document.createElement('div');
  const track = document.createElement('div');
  track.style.cssText = 'width:min(320px,80vw);height:6px;background:#2a2a33;border-radius:3px;overflow:hidden';
  const bar = document.createElement('div');
  bar.style.cssText = 'height:100%;width:0;background:#478cbf;transition:width .1s';
  track.appendChild(bar);
  panel.append(title, label, track);
  root.appendChild(panel);

  return {
    progress(text, fraction) {
      label.textContent = text;
      bar.style.width = fraction === null ? '0' : `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    error(heading, detail) {
      panel.setAttribute('role', 'alert');
      title.textContent = heading;
      title.style.color = '#f87171';
      label.textContent = detail;
      track.remove();
    },
    hide() {
      panel.remove();
    },
  };
}
