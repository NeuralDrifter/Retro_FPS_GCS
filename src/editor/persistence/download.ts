/** Saves a blob as a file through the browser's download, without leaving the page */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Large files are read after click() returns; release the URL once the download has its data
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Saves text as a file through the browser's download, without leaving the page */
export function downloadText(text: string, filename: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), filename);
}
