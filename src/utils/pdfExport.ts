const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]+/g;

/** Sanitizes a company name into a safe filesystem directory name, keeping it human-readable. */
export function sanitizeFolderName(name: string): string {
  return name.replace(INVALID_FOLDER_CHARS, '-').trim() || 'application';
}

/** Triggers a regular browser download for browsers without File System Access API support (e.g. Firefox). */
export function downloadPdfBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function writeFile(dir: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Creates (or reuses) a subdirectory named after the company and writes the given named PDF blobs into it. */
export async function writeApplicationPdfs(
  folder: FileSystemDirectoryHandle,
  companyFolderName: string,
  files: Array<{ filename: string; blob: Blob }>,
): Promise<void> {
  const companyDir = await folder.getDirectoryHandle(companyFolderName, { create: true });
  for (const { filename, blob } of files) {
    await writeFile(companyDir, filename, blob);
  }
}
