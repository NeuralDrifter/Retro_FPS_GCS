/**
 * Minimal Project Settings (release plan P3.4): the title, author, description and slug an export
 * uses. P6.2 extends it with more tabs. Saving is one undoable step.
 */
import React, { useState } from 'react';
import { PROJECT_LIMITS, SLUG_PATTERN, slugify } from '../../../shared/project';
import type { ProjectDocV4 } from '../../../shared/project';

export interface ProjectSettingsValues {
  title: string;
  author: string;
  description: string;
  slug: string;
}

export interface ProjectSettingsDialogProps {
  doc: ProjectDocV4;
  readOnly: boolean;
  onSave: (values: ProjectSettingsValues) => void;
  onClose: () => void;
}

export const ProjectSettingsDialog: React.FC<ProjectSettingsDialogProps> = ({ doc, readOnly, onSave, onClose }) => {
  const [title, setTitle] = useState(doc.meta.title);
  const [author, setAuthor] = useState(doc.meta.author);
  const [description, setDescription] = useState(doc.meta.description);
  const [slug, setSlug] = useState(doc.export.slug);

  const effectiveSlug = slug.trim() || slugify(title);
  const errors: string[] = [];
  if (!title.trim()) errors.push('The game needs a title.');
  if (!SLUG_PATTERN.test(effectiveSlug)) errors.push('The file name may use only lowercase letters, digits and single hyphens.');

  const field = 'w-full bg-[#1e1e1e] border border-[#3e3e42] px-2 py-1 text-[12px] text-[#d4d4d4] focus:outline-none focus:border-[#478cbf]';
  const label = 'block text-[11px] text-[#a0a0a0] mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        className="w-full max-w-md bg-[#252526] border border-[#3e3e42] shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (errors.length > 0 || readOnly) return;
          onSave({ title: title.trim(), author: author.trim(), description: description.trim(), slug: effectiveSlug });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="ide-panel-header">
          <h2 id="project-settings-title" className="text-[12px] font-semibold text-white">
            Project Settings
          </h2>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className={label} htmlFor="ps-title">Title</label>
            <input id="ps-title" className={field} value={title} maxLength={PROJECT_LIMITS.MAX_TITLE_CHARS} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={label} htmlFor="ps-author">Author</label>
            <input id="ps-author" className={field} value={author} maxLength={PROJECT_LIMITS.MAX_SHORT_TEXT_CHARS} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="ps-description">Description</label>
            <textarea
              id="ps-description"
              className={`${field} h-20 resize-none`}
              value={description}
              maxLength={PROJECT_LIMITS.MAX_DESCRIPTION_CHARS}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor="ps-slug">Export file name</label>
            <input id="ps-slug" className={field} value={slug} placeholder={slugify(title)} maxLength={64} onChange={(e) => setSlug(e.target.value)} />
            <p className="mt-1 text-[10px] text-[#858585]">
              Exports as <code>{effectiveSlug}-{doc.meta.version}.zip</code>
            </p>
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="text-[11px] text-[#f87171] space-y-0.5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {readOnly && <p className="text-[11px] text-[#f59e0b]">This project is read-only in this tab.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="ide-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ide-btn ide-btn--primary" disabled={errors.length > 0 || readOnly}>
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
