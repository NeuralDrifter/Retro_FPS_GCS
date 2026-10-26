/**
 * ============================================================================
 * PIE3D PLACEMENT VARIANTS ("USED IN THIS LEVEL")
 * ============================================================================
 * Groups placed copies of a model by the settings that define a variant, so
 * five identical trees list once (x5) while a non-solid one lists separately.
 * Position and rotation never create a new variant.
 */

import type { PlacedEntity } from '../../types/engine';
import type { ModelSettings, PlacementVariant } from '../../types/modelLibrary';
import { resolveEntityCategory } from './categories';

function variantSettings(e: PlacedEntity): ModelSettings {
  return {
    category: resolveEntityCategory(e),
    collision: e.collision ?? 'solid',
    footprintW: e.footprintW ?? 1,
    footprintD: e.footprintD ?? 1,
    footprintOverride: e.footprintOverride ?? false,
    scale: e.scale,
    isEnemy: e.isEnemy,
    maxHealth: e.maxHealth,
    moveSpeed: e.moveSpeed,
    attackDamage: e.attackDamage,
  };
}

export function variantKey(e: PlacedEntity): string {
  const s = variantSettings(e);
  return JSON.stringify([
    e.modelAssetId ?? e.blueprintId,
    s.category,
    s.collision,
    s.footprintW,
    s.footprintD,
    s.scale,
    s.isEnemy,
    s.maxHealth,
    s.moveSpeed,
    s.attackDamage,
  ]);
}

/** One entry per distinct variant, in order of first appearance */
export function groupPlacementsIntoVariants(entities: PlacedEntity[]): PlacementVariant[] {
  const byKey = new Map<string, PlacementVariant>();
  for (const e of entities) {
    const key = variantKey(e);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(key, {
      key,
      modelAssetId: e.modelAssetId ?? e.blueprintId,
      name: e.name,
      count: 1,
      sampleEntityId: e.id,
      settings: variantSettings(e),
    });
  }
  return [...byKey.values()];
}
