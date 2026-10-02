import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { getResourcePath } from "@openai/mcp-extensions/server";

function within(base: string, candidate: string): boolean {
  const part = relative(base, candidate);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

/** Resolve an app's relative Markdown link using host-owned opened-file metadata.
 * The server tool calls this before host-mediated opening. It grants no access and
 * returns no file contents; missing context, traversal, and symlink escapes fail closed.
 */
export async function resolveLocalLink(href: string, metadata: unknown): Promise<string> {
  const opened = getResourcePath(metadata);
  if (!opened || !isAbsolute(opened) || !/\.md$/i.test(opened)) throw new Error("Missing opened Markdown file context.");
  // The host open API accepts a filesystem path, not a URL or section target.
  if (!href || /[?#]/.test(href)) throw new Error("Unsupported local link.");
  const link = decodeURIComponent(href);
  if (!link || /[\x00-\x1f\\]/.test(link) || isAbsolute(link) || /^[a-z][a-z0-9+.-]*:/i.test(link) || !/\.md$/i.test(link)) {
    throw new Error("Unsupported local link.");
  }
  const base = dirname(opened);
  const lexical = resolve(base, link);
  if (!within(base, lexical)) throw new Error("Link leaves the opened document directory.");
  const canonicalBase = await realpath(base);
  const canonicalOpened = await realpath(opened);
  if (!within(canonicalBase, canonicalOpened) || !/\.md$/i.test(canonicalOpened) || !(await stat(canonicalOpened)).isFile()) throw new Error("Invalid opened file context.");
  const candidate = await realpath(lexical);
  if (!within(canonicalBase, candidate) || !/\.md$/i.test(candidate) || !(await stat(candidate)).isFile()) throw new Error("Invalid local target.");
  // Recheck the directory and target after stat before returning a path to the host.
  if (await realpath(base) !== canonicalBase || await realpath(candidate) !== candidate) throw new Error("Local target changed.");
  return candidate;
}
