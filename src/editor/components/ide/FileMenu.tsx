/**
 * The File menu (release plan P2.5): new, open, recent projects, save to browser storage,
 * download the project file, close. Also shows when the project is read-only or storage is
 * nearly full.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';

export interface FileMenuProps {
  recent: { id: string; title: string; savedAt: number }[];
  readOnly: boolean;
  storageOk: boolean;
  quotaWarning: string | null;
  onNew: (kind: 'blank' | 'sample') => void;
  onOpenFile: (file: File) => void;
  onOpenRecent: (id: string) => void;
  onSave: () => void;
  onDownload: () => void;
  onClose: () => void;
}

const MAX_RECENT = 8;

export const FileMenu: React.FC<FileMenuProps> = ({
  recent,
  readOnly,
  storageOk,
  quotaWarning,
  onNew,
  onOpenFile,
  onOpenRecent,
  onSave,
  onDownload,
  onClose,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const item = 'w-full text-left px-3 py-1 text-[11px] text-[#d4d4d4] hover:bg-[#094771] disabled:opacity-40 disabled:hover:bg-transparent flex justify-between gap-4';

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`ide-btn !h-[20px] ${open ? 'ide-btn--active' : ''}`}
        title="New, open, save and download projects"
      >
        <FileText className="w-3 h-3 text-[#478cbf]" />
        <span>File</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="Open project file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpenFile(file);
          e.target.value = '';
        }}
        className="hidden"
      />

      {open && (
        <div
          role="menu"
          aria-label="File"
          className="absolute left-0 top-[24px] z-50 min-w-[230px] py-1 bg-[#252526] border border-[#3e3e42] shadow-xl"
        >
          <button type="button" role="menuitem" className={item} onClick={choose(() => onNew('blank'))}>
            New Blank Project
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(() => onNew('sample'))}>
            New from Sample
          </button>
          <div className="my-1 border-t border-[#3e3e42]" />
          <button type="button" role="menuitem" className={item} onClick={choose(() => fileInputRef.current?.click())}>
            Open File…
          </button>
          <div className="px-3 pt-1 text-[10px] uppercase tracking-wide text-[#858585]">Open Recent</div>
          {recent.length === 0 && <div className="px-3 py-1 text-[11px] text-[#6b6b6b]">No saved projects yet</div>}
          {recent.slice(0, MAX_RECENT).map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className={item}
              onClick={choose(() => onOpenRecent(p.id))}
              title={`Saved ${new Date(p.savedAt).toLocaleString()}`}
            >
              <span className="truncate">{p.title}</span>
            </button>
          ))}
          <div className="my-1 border-t border-[#3e3e42]" />
          <button type="button" role="menuitem" className={item} disabled={readOnly || !storageOk} onClick={choose(onSave)}>
            <span>Save to Browser</span>
            <span className="text-[#858585]">Ctrl+S</span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(onDownload)}>
            Download Project File
          </button>
          <div className="my-1 border-t border-[#3e3e42]" />
          <button type="button" role="menuitem" className={item} onClick={choose(onClose)}>
            Close Project
          </button>
        </div>
      )}

      {readOnly && (
        <span role="status" className="px-1.5 text-[10px] font-semibold text-[#f59e0b]" title="This project is open for editing in another tab">
          Read-only
        </span>
      )}
      {quotaWarning && (
        <span role="status" className="px-1.5 text-[10px] font-semibold text-[#f87171]" title={quotaWarning}>
          Storage nearly full
        </span>
      )}
    </div>
  );
};
