/**
 * Debug runs (window.__GCS_DEBUG__) expose the open project to the e2e suite through
 * window.__gcsProbes; normal runs register nothing.
 */
import { useEffect } from 'react';
import { registerDebugProbe } from '../../runtime';
import { AssetRegistry } from '../engine/AssetRegistry';
import { buildExportRequest, exportMainThreadMaxMs, runExport } from '../export/exportClient';
import type { DocumentStore } from './documentStore';

export function useDocumentDebugProbes(store: DocumentStore, activeLevelId: string): void {
  useEffect(() => {
    const removers = [
      registerDebugProbe('projectDocument', () => store.getState().doc),
      registerDebugProbe('undoDepth', () => store.getState().past.length),
      // Which user assets the editor can show (a texture it registered, or a model file it holds)
      registerDebugProbe('userAssetStatus', () =>
        store.getState().doc.userAssets.map((a) => ({
          id: a.id,
          ready: Boolean(AssetRegistry.getTexture(a.id) || AssetRegistry.getModelFile(a.id)),
        }))
      ),
      // Runs the export worker on the open project (P3.3); P3.4 adds the menu item and its UI
      registerDebugProbe('exportGame', async () => {
        const stages: string[] = [];
        const result = await runExport(await buildExportRequest(store.getState().doc), (p) => {
          if (!stages.includes(p.stage)) stages.push(p.stage);
        }).result;
        const { bytes: _bytes, ...summary } = result;
        return { ...summary, stages, mainThreadMaxMs: exportMainThreadMaxMs() };
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [store]);
  useEffect(() => registerDebugProbe('activeLevelId', () => activeLevelId), [activeLevelId]);
}
