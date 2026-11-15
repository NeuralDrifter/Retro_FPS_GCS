/**
 * GLB inspection shared by the export pipeline (release plan P3.3).
 */

/**
 * Detects whether a GLB / glTF model requires Draco mesh compression
 * by inspecting the JSON header for `KHR_draco_mesh_compression`.
 */
export function detectDracoCompression(
  modelBytesOrText: Uint8Array | string
): boolean {
  if (typeof modelBytesOrText === 'string') {
    return modelBytesOrText.includes('KHR_draco_mesh_compression');
  }
  const bytes = modelBytesOrText;
  if (!bytes || bytes.length === 0) return false;

  // If binary GLB: magic 0x46546C67 ("glTF")
  const isGlb =
    bytes.length >= 20 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46;

  if (isGlb) {
    const chunk0Len =
      bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24);
    const jsonLen = Math.min(chunk0Len, bytes.length - 20);
    const jsonBytes = bytes.subarray(20, 20 + jsonLen);
    const jsonText = new TextDecoder('utf-8', { fatal: false }).decode(jsonBytes);
    return jsonText.includes('KHR_draco_mesh_compression');
  }

  // Fallback: scan first 64KB as text
  const scanLimit = Math.min(bytes.length, 65536);
  const headerText = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, scanLimit)
  );
  return headerText.includes('KHR_draco_mesh_compression');
}
