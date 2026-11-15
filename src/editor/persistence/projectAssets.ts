/**
 * User assets travel with the project (release plan P2.5, P2.6). Uploads become user assets
 * when they are added; textures uploaded earlier, or opened from older files, are copied into
 * `userAssets` when the project is saved. Browser storage keeps the bytes as blobs keyed by
 * SHA-256; downloaded project files embed them as base64, checked again when opened.
 */
import type { Model3DAsset, TextureAsset } from '../../runtime';
import { collectMenuTextureIds } from '../../runtime';
import type { MenuPackSpec } from '../../runtime';
import { base64ToBytes, sha256Hex } from '../../shared/bytes';
import { LICENSE_NOT_RECORDED } from '../../shared/project';
import type { ProjectDocV4, UserAsset, UserAssetMimeType } from '../../shared/project';
import { AssetRegistry } from '../engine/AssetRegistry';
import { bytesToBase64, sha256OfBytes } from '../library/uploadIntake';
import { checkGlb } from '../library/gltfSanitizer';
import { getAssetBlob, putAssetBlob } from './db';

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
    attribution: LICENSE_NOT_RECORDED,
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

// ---------------------------------------------------------------------------
// User asset bytes: in the document, in the browser's blob store, or in memory (P2.6)
// ---------------------------------------------------------------------------

/** The bytes of a user asset the editor has in memory (a registered texture or model file) */
async function bytesInMemory(asset: UserAsset): Promise<Uint8Array | null> {
  if (asset.mimeType === 'model/gltf-binary') {
    const file = AssetRegistry.getModelFile(asset.id);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  }
  const match = DATA_URL.exec(AssetRegistry.getTexture(asset.id)?.previewUrl ?? '');
  return match ? base64ToBytes(match[2].replace(/\s+/g, '')) : null;
}

/** The asset's bytes from wherever the editor has them, checked against its SHA-256 */
export async function userAssetBytes(asset: UserAsset): Promise<Uint8Array | null> {
  const candidates: (() => Promise<Uint8Array | null>)[] = [
    async () => (asset.data ? base64ToBytes(asset.data) : null),
    async () => {
      const blob = await getAssetBlob(asset.sha256).catch(() => undefined);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
    () => bytesInMemory(asset),
  ];
  for (const read of candidates) {
    const bytes = await read();
    if (bytes && bytes.length === asset.size && (await sha256OfBytes(bytes)) === asset.sha256) return bytes;
  }
  return null;
}

const stripData = (doc: ProjectDocV4): ProjectDocV4 =>
  doc.userAssets.some((a) => a.data !== undefined)
    ? { ...doc, userAssets: doc.userAssets.map(({ data: _data, ...rest }) => rest) }
    : doc;

/** For browser storage: embedded bytes move to the blob store, the document keeps only metadata */
export async function prepareForStorage(doc: ProjectDocV4): Promise<ProjectDocV4> {
  for (const asset of doc.userAssets) {
    if (!asset.data) continue;
    const bytes = base64ToBytes(asset.data);
    if (bytes) await putAssetBlob(asset.sha256, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }));
  }
  return stripData(doc);
}

/** For a downloaded project file: every user asset's bytes embedded as base64 */
export async function prepareForDownload(doc: ProjectDocV4): Promise<{ doc: ProjectDocV4; missing: string[] }> {
  const missing: string[] = [];
  const userAssets: UserAsset[] = [];
  for (const asset of doc.userAssets) {
    const bytes = await userAssetBytes(asset);
    if (bytes) userAssets.push({ ...asset, data: bytesToBase64(bytes) });
    else {
      missing.push(asset.name);
      const { data: _data, ...rest } = asset;
      userAssets.push(rest);
    }
  }
  return { doc: { ...doc, userAssets }, missing };
}

export interface ImportedAssets {
  /** The document without embedded bytes (they are now in the blob store) */
  doc: ProjectDocV4;
  textures: TextureAsset[];
  models: Model3DAsset[];
  /** Names of assets whose bytes are nowhere to be found; levels show stand-ins for them */
  missing: string[];
}

/** A library model for an uploaded GLB, with prop defaults (each placed copy keeps its own settings) */
function modelFor(asset: UserAsset): Model3DAsset {
  return {
    id: asset.id,
    blueprintId: 'custom-glb',
    name: asset.name,
    sourceType: 'file',
    isEnemy: false,
    defaultHealth: 50,
    moveSpeed: 0,
    attackDamage: 0,
    accentHex: '#38BDF8',
    badgeText: 'GLB',
    category: 'decorations',
  };
}

/**
 * Makes an opened project's user assets usable: checks each embedded file against its SHA-256,
 * keeps the bytes in the blob store, and registers textures and models with the editor.
 * Fails when an embedded file does not match its hash.
 */
export async function importUserAssets(doc: ProjectDocV4): Promise<{ ok: true; result: ImportedAssets } | { ok: false; error: string }> {
  const textures: TextureAsset[] = [];
  const models: Model3DAsset[] = [];
  const missing: string[] = [];
  for (const asset of doc.userAssets) {
    if (asset.data) {
      const bytes = base64ToBytes(asset.data);
      if (!bytes || bytes.length !== asset.size || (await sha256OfBytes(bytes)) !== asset.sha256) {
        return { ok: false, error: `The file '${asset.name}' inside this project does not match its recorded SHA-256, so the project was not opened.` };
      }
      await putAssetBlob(asset.sha256, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType })).catch(() => undefined);
    }
    const bytes = await userAssetBytes(asset);
    if (!bytes) {
      missing.push(asset.name);
      continue;
    }
    if (asset.mimeType === 'model/gltf-binary') {
      // A model from someone else's project gets the same checks as an upload (P7.2)
      const glb = checkGlb(bytes, asset.name);
      if (!glb.ok) return { ok: false, error: `${glb.error} The project was not opened.` };
      AssetRegistry.registerModelFile(asset.id, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: asset.mimeType }));
      models.push(AssetRegistry.registerModel(modelFor(asset)));
    } else {
      const texture: TextureAsset = {
        id: asset.id,
        name: asset.name,
        sourceType: 'file',
        previewUrl: `data:${asset.mimeType};base64,${asset.data ?? bytesToBase64(bytes)}`,
        recommendedSurface: 'any',
      };
      textures.push(AssetRegistry.registerTexture(texture));
    }
  }
  return { ok: true, result: { doc: stripData(doc), textures, models, missing } };
}
