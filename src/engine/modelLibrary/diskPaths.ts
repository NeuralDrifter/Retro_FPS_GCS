/**
 * ============================================================================
 * PIE3D MODEL DISK FOLDER CLASSIFICATION (`/src/assets/models/`)
 * ============================================================================
 *  - `<category>/<sub/folders>/file.glb`: the first folder picks the category
 *    (characters, decorations, items, buildings, vehicles), deeper folders
 *    become custom library folders inside it.
 *  - `<other>/<sub>/file.glb`: a custom root folder, category 'decorations'.
 *  - Files directly in the models folder keep the legacy filename rule:
 *    `prop_`, `prop-`, `crate_`, `static_` prefixes are decorations, anything
 *    else is a character.
 */

import type { ModelCategoryId } from '../../types/modelLibrary';
import { isModelCategoryId } from './categories';

const MODELS_ROOT = '/src/assets/models/';
const LEGACY_PROP_PREFIXES = ['prop_', 'prop-', 'crate_', 'static_'];

export function parseModelDiskPath(globPath: string): {
  category: ModelCategoryId;
  folderPath: string | null;
} {
  const rel = globPath.startsWith(MODELS_ROOT)
    ? globPath.slice(MODELS_ROOT.length)
    : globPath.replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  const fileName = (parts.pop() ?? '').toLowerCase();

  if (parts.length === 0) {
    const isProp = LEGACY_PROP_PREFIXES.some((p) => fileName.startsWith(p));
    return { category: isProp ? 'decorations' : 'characters', folderPath: null };
  }

  const [first, ...rest] = parts;
  const firstLower = first.toLowerCase();
  if (isModelCategoryId(firstLower)) {
    return {
      category: firstLower,
      folderPath: rest.length > 0 ? rest.join('/') : null,
    };
  }
  return { category: 'decorations', folderPath: parts.join('/') };
}
