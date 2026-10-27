/**
 * ============================================================================
 * EDITOR LEVEL SERIALIZER & FILE DOWNLOAD MANAGER (`src/engine/LevelSerializer.ts`)
 * ============================================================================
 * Runtime serialization & v1/v2->v3 migration live in `src/runtime/LevelSerializer.ts`.
 * Editor-only browser file download (`downloadLevelJson`) stays here.
 */

import { LevelStateData } from '../runtime/types';
import {
  RuntimeLevelSerializer,
  computeNextEntityId,
  placedEntitiesFromLevelV3,
} from '../runtime/LevelSerializer';

export { computeNextEntityId, placedEntitiesFromLevelV3 };

export class LevelSerializer extends RuntimeLevelSerializer {
  /**
   * Triggers a browser download of the serialized level state as a `.json` file.
   */
  public static downloadLevelJson(
    state: LevelStateData,
    filename?: string
  ): void {
    const jsonString = JSON.stringify(state, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      filename ||
      `gridforge-level-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}
