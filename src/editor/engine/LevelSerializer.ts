/**
 * ============================================================================
 * EDITOR LEVEL SERIALIZER & FILE DOWNLOAD MANAGER (`src/editor/engine/LevelSerializer.ts`)
 * ============================================================================
 * LevelDataV3 serialization and validation live in `src/runtime/LevelSerializer.ts`;
 * the editor save format and v1/v2 migration live in `src/editor/project/legacy.ts`.
 * Editor-only browser file download (`downloadLevelJson`) stays here.
 */

import { LevelStateData } from '../../runtime';
import { computeNextEntityId, placedEntitiesFromLevelV3 } from '../../runtime';
import { LegacyLevelSerializer } from '../project/legacy';

export { computeNextEntityId, placedEntitiesFromLevelV3 };

export class LevelSerializer extends LegacyLevelSerializer {
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
