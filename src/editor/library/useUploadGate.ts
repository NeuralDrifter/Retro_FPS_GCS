/**
 * Every upload passes here (release plan P2.6): the file checks in uploadIntake, then a license
 * choice, then the bytes go to the browser's blob store. The Asset Library registers the
 * accepted files and calls `addToProject` with each one's final id.
 */
import { useCallback, useRef, useState } from 'react';
import type { UserAssetLicense } from '../../shared/project';
import { putAssetBlob } from '../persistence/db';
import type { DocContext } from '../store/useEditorDocument';
import { MAX_TEXTURE_SIDE, intakeUpload } from './uploadIntake';
import type { AcceptedUpload, UploadKind } from './uploadIntake';

export interface LicenseChoice {
  license: UserAssetLicense;
  /** Required for CC-BY-4.0 and other */
  attribution?: string;
}

export type LicensedUpload = AcceptedUpload & LicenseChoice;

export interface LicenseRequest {
  kind: UploadKind;
  names: string[];
}

export function useUploadGate(ctx: DocContext) {
  const [licenseRequest, setLicenseRequest] = useState<LicenseRequest | null>(null);
  const resolveRef = useRef<((choice: LicenseChoice | null) => void) | null>(null);
  const warnedStorageRef = useRef(false);

  const requestUploads = useCallback(
    async (files: File[], kind: UploadKind): Promise<LicensedUpload[]> => {
      const accepted: AcceptedUpload[] = [];
      for (const file of files) {
        const result = await intakeUpload(file, kind);
        if (result.ok) accepted.push(result.upload);
        else ctx.log(`Upload refused: ${result.error}`);
      }
      if (accepted.length === 0) return [];

      const choice = await new Promise<LicenseChoice | null>((resolve) => {
        resolveRef.current = resolve;
        setLicenseRequest({ kind, names: accepted.map((u) => u.name) });
      });
      resolveRef.current = null;
      setLicenseRequest(null);
      if (!choice) {
        ctx.log('Upload cancelled: a license is needed for every uploaded file.');
        return [];
      }

      for (const upload of accepted) {
        try {
          await putAssetBlob(upload.sha256, upload.file);
        } catch {
          if (!warnedStorageRef.current) {
            warnedStorageRef.current = true;
            ctx.log('Uploads are kept for this session only: browser storage is unavailable. Download the project file to keep them.');
          }
        }
        if (upload.scaledFrom) {
          ctx.log(
            `Upload: '${upload.name}' was ${upload.scaledFrom.width}x${upload.scaledFrom.height}; it was scaled down to fit ${MAX_TEXTURE_SIDE} px.`
          );
        }
      }
      return accepted.map((upload) => ({ ...upload, ...choice }));
    },
    [ctx]
  );

  const resolveLicense = useCallback((choice: LicenseChoice | null) => resolveRef.current?.(choice), []);

  /** Records an accepted upload in the project under the id the library gave it */
  const addToProject = useCallback(
    (upload: LicensedUpload, id: string, name: string) => {
      ctx.edit(
        {
          type: 'userAsset/add',
          asset: {
            id,
            name: name.slice(0, 200) || id,
            mimeType: upload.mimeType,
            sha256: upload.sha256,
            size: upload.bytes.length,
            license: upload.license,
            ...(upload.attribution ? { attribution: upload.attribution.slice(0, 1000) } : {}),
          },
        },
        `Upload '${name}'`
      );
    },
    [ctx]
  );

  return { licenseRequest, resolveLicense, requestUploads, addToProject };
}
