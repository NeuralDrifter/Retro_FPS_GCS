import React, { useMemo, useState } from 'react';
import type { LibraryFolder, ModelLibraryState } from '../../../types/modelLibrary';
import { Folder, FolderPlus, Pencil, Trash2, Check, X, Library } from 'lucide-react';

interface ModelFolderTreeProps {
  state: ModelLibraryState;
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropModel: (modelId: string, folderId: string) => void;
}

const MODEL_DRAG_TYPE = 'application/gridforge-model-id';
const EMPTY_FOLDERS: LibraryFolder[] = [];

/**
 * Folder tree of the model library: built-in category folders plus user
 * folders. Model cards dragged onto a folder are moved into it.
 */
export const ModelFolderTree: React.FC<ModelFolderTreeProps> = ({
  state,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDropModel,
}) => {
  const [editing, setEditing] = useState<
    { mode: 'create'; parentId: string | null } | { mode: 'rename'; folderId: string } | null
  >(null);
  const [draftName, setDraftName] = useState('');
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, LibraryFolder[]>();
    for (const f of state.folders) {
      const list = map.get(f.parentId);
      if (list) list.push(f);
      else map.set(f.parentId, [f]);
    }
    return map;
  }, [state.folders]);

  const childrenOf = (parentId: string | null): LibraryFolder[] =>
    childrenByParent.get(parentId) ?? EMPTY_FOLDERS;

  const commitEdit = () => {
    const name = draftName.trim();
    if (editing && name) {
      if (editing.mode === 'create') onCreateFolder(name, editing.parentId);
      else onRenameFolder(editing.folderId, name);
    }
    setEditing(null);
    setDraftName('');
  };

  const nameInput = (
    <span className="flex items-center gap-1 flex-1 min-w-0">
      <input
        autoFocus
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') setEditing(null);
        }}
        aria-label="Folder name"
        className="ide-input !h-[18px] flex-1 min-w-0"
      />
      <button type="button" onClick={commitEdit} className="ide-btn !h-[18px] !px-1" title="Save">
        <Check className="w-2.5 h-2.5" />
      </button>
      <button type="button" onClick={() => setEditing(null)} className="ide-btn !h-[18px] !px-1" title="Cancel">
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );

  const renderFolder = (folder: LibraryFolder, depth: number): React.ReactNode => {
    const isSelected = folder.id === selectedFolderId;
    const isCustom = folder.categoryId === undefined;
    const isRenaming = editing?.mode === 'rename' && editing.folderId === folder.id;
    const isCreatingHere = editing?.mode === 'create' && editing.parentId === folder.id;
    return (
      <li key={folder.id}>
        <div
          onClick={() => onSelectFolder(folder.id)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(MODEL_DRAG_TYPE)) {
              e.preventDefault();
              setDropTargetId(folder.id);
            }
          }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={(e) => {
            const modelId = e.dataTransfer.getData(MODEL_DRAG_TYPE);
            setDropTargetId(null);
            if (modelId) {
              e.preventDefault();
              onDropModel(modelId.trim(), folder.id);
            }
          }}
          style={{ paddingLeft: 4 + depth * 12 }}
          className={`group flex items-center gap-1 h-[20px] pr-1 text-[11px] cursor-pointer ${
            dropTargetId === folder.id
              ? 'bg-[#094771] text-white'
              : isSelected
              ? 'bg-[#094771]/60 text-white'
              : 'text-[#cccccc] hover:bg-[#2a2d2e]'
          }`}
        >
          <Folder className={`w-3 h-3 shrink-0 ${isCustom ? 'text-[#c5a35a]' : 'text-[#478cbf]'}`} />
          {isRenaming ? (
            nameInput
          ) : (
            <>
              <span className="truncate flex-1">{folder.name}</span>
              <span className="hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDraftName('');
                    setEditing({ mode: 'create', parentId: folder.id });
                  }}
                  className="p-0.5 text-[#858585] hover:text-white"
                  title="New folder inside"
                >
                  <FolderPlus className="w-2.5 h-2.5" />
                </button>
                {isCustom && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraftName(folder.name);
                        setEditing({ mode: 'rename', folderId: folder.id });
                      }}
                      className="p-0.5 text-[#858585] hover:text-white"
                      title="Rename folder"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFolder(folder.id);
                      }}
                      className="p-0.5 text-[#858585] hover:text-[#f48771]"
                      title="Delete folder (its models move up a level)"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </>
                )}
              </span>
            </>
          )}
        </div>
        {(childrenOf(folder.id).length > 0 || isCreatingHere) && (
          <ul>
            {childrenOf(folder.id).map((child) => renderFolder(child, depth + 1))}
            {isCreatingHere && (
              <li style={{ paddingLeft: 4 + (depth + 1) * 12 }} className="flex h-[20px] items-center">
                {nameInput}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="border border-[#333333] bg-[#181818] py-0.5">
      <div
        onClick={() => onSelectFolder(null)}
        className={`flex items-center gap-1 h-[20px] px-1 text-[11px] cursor-pointer ${
          selectedFolderId === null ? 'bg-[#094771]/60 text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
        }`}
      >
        <Library className="w-3 h-3 text-[#4ec9b0]" />
        <span className="flex-1">All Models</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDraftName('');
            setEditing({ mode: 'create', parentId: null });
          }}
          className="p-0.5 text-[#858585] hover:text-white"
          title="New folder at the top level"
        >
          <FolderPlus className="w-2.5 h-2.5" />
        </button>
      </div>
      <ul>
        {childrenOf(null).map((folder) => renderFolder(folder, 0))}
        {editing?.mode === 'create' && editing.parentId === null && (
          <li className="flex h-[20px] items-center px-1">{nameInput}</li>
        )}
      </ul>
    </div>
  );
};
