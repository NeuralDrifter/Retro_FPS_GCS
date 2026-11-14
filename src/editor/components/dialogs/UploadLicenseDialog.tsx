/**
 * Asked for every upload (release plan P2.6): who may use the file decides whether the game
 * can be shared, so the editor records it with the project and the export credits it.
 */
import React, { useState } from 'react';
import type { UserAssetLicense } from '../../../shared/project';
import type { LicenseChoice } from '../../library/useUploadGate';

const OPTIONS: { value: UserAssetLicense; label: string; hint: string }[] = [
  { value: 'own-work', label: 'I made it', hint: 'You created this file yourself.' },
  { value: 'CC0-1.0', label: 'CC0 (public domain)', hint: 'Anyone may use it for anything, no credit needed.' },
  { value: 'CC-BY-4.0', label: 'CC BY 4.0', hint: 'Free to use with credit to the author. Enter the credit line below.' },
  { value: 'other', label: 'Another license', hint: 'Name the license and the author below.' },
];

export interface UploadLicenseDialogProps {
  kind: 'texture' | 'model';
  names: string[];
  onConfirm: (choice: LicenseChoice) => void;
  onCancel: () => void;
}

export const UploadLicenseDialog: React.FC<UploadLicenseDialogProps> = ({ kind, names, onConfirm, onCancel }) => {
  const [license, setLicense] = useState<UserAssetLicense | null>(null);
  const [attribution, setAttribution] = useState('');
  const needsCredit = license === 'CC-BY-4.0' || license === 'other';
  const valid = license !== null && (!needsCredit || attribution.trim().length > 0);
  const what = kind === 'texture' ? 'texture' : 'model';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="upload-license-title" className="w-full max-w-md bg-[#252526] border border-[#3e3e42] shadow-2xl">
        <div className="ide-panel-header">
          <h2 id="upload-license-title" className="text-[12px] font-semibold text-white">
            License for {names.length === 1 ? `'${names[0]}'` : `${names.length} ${what}s`}
          </h2>
        </div>
        <form
          className="p-4 space-y-3 text-[12px] text-[#d4d4d4]"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm({ license: license!, ...(needsCredit ? { attribution: attribution.trim() } : {}) });
          }}
        >
          <p className="text-[#a0a0a0]">
            Choose who may use {names.length === 1 ? `this ${what}` : `these ${what}s`}. The license is saved with the project and
            listed when you export the game.
          </p>
          <fieldset className="space-y-1.5">
            <legend className="sr-only">License</legend>
            {OPTIONS.map((o) => (
              <label key={o.value} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="license" value={o.value} checked={license === o.value} onChange={() => setLicense(o.value)} className="mt-0.5" />
                <span>
                  <span className="text-white">{o.label}</span>
                  <span className="block text-[10px] text-[#858585]">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {needsCredit && (
            <label className="block space-y-1">
              <span className="ide-label">Credit (author, title, source, license)</span>
              <textarea
                value={attribution}
                onChange={(e) => setAttribution(e.target.value)}
                maxLength={1000}
                rows={2}
                className="ide-input w-full !h-auto"
              />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="ide-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="ide-btn ide-btn--primary" disabled={!valid}>
              Add {names.length === 1 ? what : `${names.length} ${what}s`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
