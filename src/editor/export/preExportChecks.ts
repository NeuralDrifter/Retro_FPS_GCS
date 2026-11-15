/**
 * Checks that run before an export starts (release plan P3.4). When any of them fails, the editor
 * lists the problems and nothing downloads. They cover what the creator can fix in the editor; the
 * export worker still checks every file it packs.
 */
import { SimCellType } from '../../sim';
import type { ExportRequest } from '../../export/exportGame';
import { projectAssetIds } from '../../export/references';
import { LICENSE_NOT_RECORDED, PROJECT_LIMITS } from '../../shared/project';
import type { ProjectDocV4 } from '../../shared/project';

export interface ExportProblem {
  /** Where to look, e.g. a level title or an asset name */
  where: string;
  message: string;
}

/** The manifest's limit on asset files (see `checkGameManifest`) */
const MAX_EXPORT_ASSETS = 4096;

export function checkBeforeExport(doc: ProjectDocV4, request: ExportRequest): ExportProblem[] {
  const problems: ExportProblem[] = [];

  // A player start inside the map, on a cell the player can stand in
  for (const level of doc.levels) {
    const { spawn, grid, gridSize } = level.data;
    const inside = spawn && spawn.row >= 0 && spawn.col >= 0 && spawn.row < gridSize && spawn.col < gridSize;
    if (!inside) {
      problems.push({ where: level.title, message: 'The level has no player start inside the map. Place one with the spawn tool.' });
    } else if (grid[spawn.row]?.[spawn.col] === SimCellType.WALL) {
      problems.push({ where: level.title, message: 'The player start is inside a wall. Move it to an open cell.' });
    }
  }

  // Every asset needs a file and a license the export can credit
  const used = projectAssetIds(doc);
  const uploads = new Map(doc.userAssets.map((a) => [a.id, a]));
  for (const [kind, ids] of [['texture', used.textures], ['model', used.models]] as const) {
    for (const id of ids) {
      const upload = uploads.get(id);
      const source = request.sources[id];
      const name = upload?.name ?? (source && 'name' in source ? source.name : id);
      if (upload && upload.license === 'other' && upload.attribution === LICENSE_NOT_RECORDED) {
        problems.push({
          where: name,
          message: `This ${kind} was uploaded before the editor asked for a license, so the export cannot credit it. Upload it again and choose its license.`,
        });
      } else if (!source || (source.type === 'user' && !source.bytes && !source.blob && !source.base64)) {
        problems.push({ where: name, message: `The editor has no file for this ${kind}. Upload it again or replace it.` });
      } else if (source.type === 'unlicensed') {
        problems.push({
          where: name,
          message: `This ${kind} comes from an asset repository that publishes no license list (packs.json), so the export cannot credit it. Replace it with a library or uploaded ${kind}.`,
        });
      }
    }
  }

  // Package limits
  if (doc.levels.length > PROJECT_LIMITS.MAX_LEVELS) {
    problems.push({ where: 'Project', message: `A game can have at most ${PROJECT_LIMITS.MAX_LEVELS} levels; this one has ${doc.levels.length}.` });
  }
  const assetCount = used.textures.length + used.models.length;
  if (assetCount > MAX_EXPORT_ASSETS) {
    problems.push({ where: 'Project', message: `A game can use at most ${MAX_EXPORT_ASSETS} textures and models; this one uses ${assetCount}.` });
  }
  return problems;
}
