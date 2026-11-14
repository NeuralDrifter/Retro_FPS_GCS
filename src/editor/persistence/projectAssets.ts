/**
 * Uploaded textures travel with the project (release plan P2.5). Until P2.6 makes uploads
 * user assets at upload time, saving copies each uploaded texture the project uses into
 * `userAssets`, and opening a project registers those textures with the editor again.
 */
import type { TextureAsset } from '../../runtime';
import { collectMenuTextureIds } from '../../runtime';
import type { MenuPackSpec } from '../../runtime';
import { base64ToBytes, sha256Hex } from '../../shared/bytes';
import type { ProjectDocV4, UserAsset, UserAssetMimeType } from '../../shared/project';

/** Every texture id the project's levels and menus use */
export function usedTextureIds(doc: ProjectDocV4): Set<string> {
  const ids = new Set<string>();
  const add = (m: string[][]) => {
    for (const row of m) for (const id of row) ids.add(id);
  };
  for (const level of doc.levels) {
    const d = level.data;
    add(d.wallTextures);
    add(d.floorTextures);
    add(d.ceilingTextures);
    for (const layer of d.layers ?? []) {
      add(layer.wallTextures);
      add(layer.floorTextures);
      add(layer.ceilingTextures);
    }
  }
  const menus = doc.campaign.menus as unknown as MenuPackSpec | undefined;
  if (menus) for (const id of collectMenuTextureIds(menus)) ids.add(id);
  return ids;
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s;

/** A user asset for an uploaded texture, or null when it is not an embedded PNG, JPEG or WebP */
function uploadToUserAsset(texture: TextureAsset): UserAsset | null {
  const match = DATA_URL.exec(texture.previewUrl);
  const data = match?.[2].replace(/\s+/g, '');
  const bytes = data ? base64ToBytes(data) : null;
  if (!match || !data || !bytes || bytes.length === 0) return null;
  return {
    id: texture.id,
    name: texture.name.slice(0, 200) || texture.id,
    mimeType: match[1] as UserAssetMimeType,
    sha256: sha256Hex(bytes),
    size: bytes.length,
    // The upload dialog asks for a license from P2.6; until then it is not recorded
    license: 'other',
    attribution: 'Uploaded before the editor recorded licenses.',
    data,
  };
}

/** The project with every uploaded texture it uses embedded in `userAssets` */
export function embedUploadedTextures(doc: ProjectDocV4, catalog: TextureAsset[]): ProjectDocV4 {
  const used = usedTextureIds(doc);
  const have = new Set(doc.userAssets.map((a) => a.id));
  const added: UserAsset[] = [];
  for (const texture of catalog) {
    if (texture.fromProject || texture.sourceType !== 'file' || !used.has(texture.id) || have.has(texture.id)) continue;
    const asset = uploadToUserAsset(texture);
    if (asset) added.push(asset);
  }
  return added.length > 0 ? { ...doc, userAssets: [...doc.userAssets, ...added] } : doc;
}

/** Textures for the editor's catalog from the project's embedded image assets */
export function texturesFromUserAssets(doc: ProjectDocV4): TextureAsset[] {
  return doc.userAssets
    .filter((a) => a.data && a.mimeType.startsWith('image/'))
    .map((a) => ({
      id: a.id,
      name: a.name,
      sourceType: 'file' as const,
      previewUrl: `data:${a.mimeType};base64,${a.data}`,
      recommendedSurface: 'any' as const,
    }));
}
