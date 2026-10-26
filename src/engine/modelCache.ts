/**
 * ============================================================================
 * PIE3D LOADED MODEL CACHE (KEEP ONLY WHAT THE LEVEL USES)
 * ============================================================================
 * Zero Three.js imports, so it runs under the Node test runner. Each loaded
 * model is shared by every placed copy; after every world build the cache
 * keeps only the models that world uses and disposes the rest, so memory
 * follows the level instead of growing with every model ever loaded.
 */

export interface ModelSourceLookups {
  /** True when an uploaded file is kept for this model id */
  hasFile: (modelId: string) => boolean;
  /** Permanent URL (web address or project file) for this model id */
  urlFor: (modelId: string) => string | undefined;
}

export interface ModelSource {
  key: string;
  /** Load from the uploaded file kept for this model id */
  fileId?: string;
  /** Load from this URL */
  url?: string;
}

/**
 * Where a placed copy's model comes from. A stored file wins, then a permanent
 * URL; `blob:` links saved on old copies are dead after a reload and ignored.
 * With neither, the copy uses its built-in blueprint model.
 */
export function modelCacheKey(
  entity: { blueprintId: string; modelAssetId?: string; customGlbUrl?: string },
  lookups: ModelSourceLookups
): ModelSource {
  const id = entity.modelAssetId;
  if (id && lookups.hasFile(id)) return { key: `file:${id}`, fileId: id };
  const savedUrl = entity.customGlbUrl?.startsWith('blob:') ? undefined : entity.customGlbUrl;
  const url = (id && lookups.urlFor(id)) || savedUrl;
  if (url) return { key: `url:${url}`, url };
  return { key: `builtin:${entity.blueprintId}` };
}

export class ModelCache<T> {
  private entries = new Map<string, Promise<T>>();

  constructor(private readonly dispose: (model: T) => void) {}

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** The cached model for `key`, loading it once; a failed load is forgotten so it can be retried */
  get(key: string, load: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = load();
      this.entries.set(key, entry);
      entry.catch(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      });
    }
    return entry;
  }

  /**
   * Drops every model whose key is not in `keep` (and not pinned), disposing
   * it once it has finished loading.
   */
  retainOnly(keep: Set<string>, isPinned: (key: string) => boolean = () => false): void {
    for (const [key, entry] of this.entries) {
      if (keep.has(key) || isPinned(key)) continue;
      this.entries.delete(key);
      entry.then(this.dispose, () => {});
    }
  }
}
