import React, { useState } from 'react';
import { X } from 'lucide-react';

interface ModelTagEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

/** Tag chips with remove buttons and an input that adds a tag on Enter */
export const ModelTagEditor: React.FC<ModelTagEditorProps> = ({ tags, onChange }) => {
  const [draft, setDraft] = useState('');

  const addDraft = () => {
    const tag = draft.trim();
    if (tag) onChange([...tags, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 px-1.5 h-[16px] text-[10px] bg-[#252526] border border-[#3e3e42] text-[#cccccc]"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="text-[#858585] hover:text-white"
            title={`Remove tag '${tag}'`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addDraft();
          }
        }}
        onBlur={addDraft}
        placeholder="Add tag..."
        aria-label="Add tag"
        className="ide-input !h-[16px] !text-[10px] w-20"
      />
    </div>
  );
};
