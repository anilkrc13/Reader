import { open, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname } from "node:path";
import { resolveLocalAsset } from "./local-links.js";

const mimeTypes: Record<string, string> = {
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
};
const limit = 8 * 1024 * 1024;

// Read only a bounded image beside the host-opened Markdown file. No caller path
// is accepted as document context. SVG is displayed as an img, never inline HTML.
export async function readLocalImage(href: string, metadata: unknown): Promise<string> {
  const path = await resolveLocalAsset(href, metadata, /\.(?:svg|png|jpe?g|gif|webp)$/i);
  const expected = await stat(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit || info.dev !== expected.dev || info.ino !== expected.ino) throw new Error("Invalid image.");
    // Recheck containment after opening, including changes to parent directories.
    if (await resolveLocalAsset(href, metadata, /\.(?:svg|png|jpe?g|gif|webp)$/i) !== path || await realpath(path) !== path) throw new Error("Image changed.");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (!size || size > limit) throw new Error("Invalid image size.");
    return `data:${mimeTypes[extname(path).toLowerCase()]};base64,${buffer.subarray(0, size).toString("base64")}`;
  } finally { await file.close(); }
}
