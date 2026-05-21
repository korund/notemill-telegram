export async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`telegram: download ${filePath} failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export function extensionOf(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0 || idx === filePath.length - 1) return 'bin';
  return filePath.slice(idx + 1).toLowerCase();
}
