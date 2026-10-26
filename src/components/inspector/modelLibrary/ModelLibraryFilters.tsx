import React from 'react';
import { Search, MapPin } from 'lucide-react';

interface ModelLibraryFiltersProps {
  search: string;
  onSearch: (value: string) => void;
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  usedOnly: boolean;
  onToggleUsedOnly: () => void;
}

/** Name/tag search, tag chips (all selected tags must match), and the used-in-level toggle */
export const ModelLibraryFilters: React.FC<ModelLibraryFiltersProps> = ({
  search,
  onSearch,
  allTags,
  selectedTags,
  onToggleTag,
  usedOnly,
  onToggleUsedOnly,
}) => (
  <div className="space-y-1.5">
    <div className="flex gap-1">
      <label className="relative flex-1 min-w-0">
        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#858585] pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search models or tags..."
          aria-label="Search models"
          className="ide-input w-full !pl-5"
        />
      </label>
      <button
        type="button"
        onClick={onToggleUsedOnly}
        className={`ide-btn !px-1.5 ${usedOnly ? 'ide-btn--active' : ''}`}
        title="Show only models placed in the current level"
      >
        <MapPin className="w-3 h-3" />
        <span className="text-[10px]">Used in level</span>
      </button>
    </div>
    {allTags.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {allTags.map((tag) => {
          const isOn = selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggleTag(tag)}
              className={`px-1.5 h-[16px] text-[10px] border rounded-[2px] ${
                isOn
                  ? 'bg-[#478cbf] border-[#478cbf] text-white'
                  : 'bg-[#181818] border-[#3e3e42] text-[#cccccc] hover:border-[#478cbf]'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    )}
  </div>
);
