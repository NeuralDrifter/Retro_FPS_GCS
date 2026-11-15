/**
 * "Download recovery file" (release plan P6.1): the open project as a project file, reachable
 * even after the editor itself crashed. The document store registers itself here when it is
 * created, so the store outlives the React tree that showed it.
 */
import { canonicalStringify } from '../../../shared/project';
import type { ProjectDocV4 } from '../../../shared/project';
import { prepareForDownload } from '../../persistence/projectAssets';
import { downloadText } from '../../persistence/download';

let source: (() => ProjectDocV4) | null = null;

export function registerRecoverySource(getDoc: () => ProjectDocV4): void {
  source = getDoc;
}

export function hasRecoverySource(): boolean {
  return source !== null;
}

/** Downloads the open project; uploads are embedded when the editor can still find them */
export async function downloadRecoveryFile(): Promise<boolean> {
  if (!source) return false;
  const doc = source();
  let text: string;
  try {
    text = canonicalStringify((await prepareForDownload(doc)).doc);
  } catch {
    // The project matters more than its uploads
    text = canonicalStringify(doc);
  }
  downloadText(text, `${doc.export.slug || 'game'}-recovery.gcs.json`);
  return true;
}
