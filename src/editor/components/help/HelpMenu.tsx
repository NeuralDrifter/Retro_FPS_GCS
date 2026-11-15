/**
 * The Help menu and what it opens (release plan P6.7): the welcome screen (shown once on a
 * first visit), keyboard shortcuts, the documentation link and About.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { PROJECT_SCHEMA_VERSION } from '../../../shared/project';
import { GAME_MANIFEST_SCHEMA_VERSION } from '../../../shared/project/gameManifest';
import { RUNTIME_VERSION } from '../../../shared/versions';
import { EDITOR_VERSION } from '../../store/useEditorDocument';

export const DOCS_URL = 'https://github.com/NeuralDrifter/Retro_FPS_GCS#readme';
const WELCOMED_KEY = 'gcs:welcomed';

export interface WelcomeActions {
  recent: { id: string; title: string; savedAt: number }[];
  onNew: (kind: 'blank' | 'sample') => void;
  onOpenFile: (file: File) => void;
  onOpenRecent: (id: string) => void;
}

function readWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === '1';
  } catch {
    return true;
  }
}

function rememberWelcomed() {
  try {
    localStorage.setItem(WELCOMED_KEY, '1');
  } catch {
    // Private windows may refuse; the screen then shows again next visit
  }
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y or Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+S', 'Save to browser storage'],
  ['Click or drag on the 2D map', 'Use the selected tool'],
  ['Right-click on the 2D map', 'Erase'],
  ['Hold right mouse + W A S D Q E (3D editor)', 'Fly the camera; Shift is faster, the wheel sets the speed'],
  ['Click (3D editor)', 'Select a model or tile'],
  ['G / R / F (3D editor)', 'Move, rotate or focus the selected model'],
  ['Delete (3D editor)', 'Delete the selected model'],
  ['W A S D and the mouse (Test Play)', 'Move and look'],
  ['Left mouse or F (Test Play)', 'Fire'],
  ['R (Test Play)', 'Reload'],
  ['E (Test Play)', 'Use doors and switches; Space too, unless the level allows jumping'],
  ['M (Test Play)', 'Show or hide the minimap'],
  ['Esc', 'Release the mouse, close menus'],
];

const overlay = 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4';
const panel = 'w-full bg-[#252526] border border-[#3e3e42] shadow-2xl text-[12px] text-[#d4d4d4]';

function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={overlay}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`${panel} ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        <div className="ide-panel-header">
          <h2 className="text-[12px] font-semibold text-white">{title}</h2>
          <button type="button" className="ide-btn !h-[18px] !px-1.5 !text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export const HelpMenu: React.FC<{ welcome: WelcomeActions; canWelcome: boolean }> = ({ welcome, canWelcome }) => {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<'welcome' | 'shortcuts' | 'about' | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The first visit opens the welcome screen (after any recovery prompt)
  useEffect(() => {
    if (canWelcome && !readWelcomed()) setShown('welcome');
  }, [canWelcome]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const show = (what: typeof shown) => () => {
    setOpen(false);
    setShown(what);
  };
  const closeWelcome = () => {
    rememberWelcomed();
    setShown(null);
  };
  const welcomeAction = (action: () => void) => () => {
    closeWelcome();
    action();
  };
  const item = 'w-full text-left px-3 py-1 text-[11px] text-[#d4d4d4] hover:bg-[#094771] block';

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="ide-btn !h-[20px]" title="Welcome, shortcuts, documentation and versions">
        <HelpCircle className="w-3 h-3" />
        <span>Help</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) welcome.onOpenFile(file);
          e.target.value = '';
        }}
      />
      {open && (
        <div role="menu" aria-label="Help" className="absolute right-0 top-[24px] z-50 min-w-[200px] py-1 bg-[#252526] border border-[#3e3e42] shadow-xl">
          <button type="button" role="menuitem" className={item} onClick={show('welcome')}>
            Welcome
          </button>
          <button type="button" role="menuitem" className={item} onClick={show('shortcuts')}>
            Keyboard Shortcuts
          </button>
          <a role="menuitem" className={item} href={DOCS_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            Documentation
          </a>
          <button type="button" role="menuitem" className={item} onClick={show('about')}>
            About
          </button>
        </div>
      )}

      {shown === 'welcome' && (
        <Dialog title="Welcome to Retro FPS GCS" onClose={closeWelcome}>
          <p>Build first-person levels, test them right here, and export a game anyone can play in a browser.</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className="ide-btn ide-btn--primary justify-center" onClick={welcomeAction(() => welcome.onNew('blank'))}>
              New project
            </button>
            <button type="button" className="ide-btn justify-center" onClick={welcomeAction(() => fileInputRef.current?.click())}>
              Open file
            </button>
            <button type="button" className="ide-btn justify-center" onClick={welcomeAction(() => welcome.onNew('sample'))}>
              Open sample
            </button>
          </div>
          {welcome.recent.length > 0 && (
            <div className="space-y-1">
              <div className="ide-label">Recent projects</div>
              {welcome.recent.slice(0, 5).map((p) => (
                <button key={p.id} type="button" className="ide-btn w-full justify-between" onClick={welcomeAction(() => welcome.onOpenRecent(p.id))}>
                  <span className="truncate">{p.title}</span>
                  <span className="text-[10px] text-[#858585]">{new Date(p.savedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[#a0a0a0]">Close this to keep editing the current project. Help &gt; Welcome brings it back.</p>
        </Dialog>
      )}

      {shown === 'shortcuts' && (
        <Dialog title="Keyboard Shortcuts" onClose={() => setShown(null)} wide>
          <table className="w-full">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys} className="border-b border-[#3e3e42]">
                  <td className="py-1 pr-3 font-mono text-[11px] text-white whitespace-nowrap">{keys}</td>
                  <td className="py-1">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      )}

      {shown === 'about' && (
        <Dialog title="About Retro FPS GCS" onClose={() => setShown(null)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-[#858585]">Editor</dt>
            <dd>{EDITOR_VERSION}</dd>
            <dt className="text-[#858585]">Game runtime</dt>
            <dd>{RUNTIME_VERSION}</dd>
            <dt className="text-[#858585]">Project file schema</dt>
            <dd>{PROJECT_SCHEMA_VERSION}</dd>
            <dt className="text-[#858585]">Game data schema</dt>
            <dd>{GAME_MANIFEST_SCHEMA_VERSION}</dd>
          </dl>
          <p className="text-[#a0a0a0]">
            Built with three.js (MIT) and React (MIT). Your projects stay in this browser unless you download them; the editor sends nothing anywhere.
          </p>
        </Dialog>
      )}
    </div>
  );
};
