import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
const execute = promisify(execFile);

/** Thin stdio adapter to the same Python service used by Reader's HTTP server. */
export async function fontCatalog() {
  const unavailable = {version: 1, platform: process.platform, provenance: "backend-machine",
    rendering: "viewer-verification-required", available: false, families: [],
    reason: "Installed font discovery needs Python 3 on the backend machine."};
  const script = fileURLToPath(new URL("./fonts.py", import.meta.url));
  const interpreters = process.platform === "win32" ? [["py", "-3"], ["python3"], ["python"]] : [["python3"]];
  for (const [command, ...args] of interpreters) {
    try {
      const {stdout} = await execute(command, [...args, script], {timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true});
      const result = JSON.parse(stdout);
      if (result.version !== 1 || !Array.isArray(result.families)) return unavailable;
      return result;
    } catch { /* Try the next standard Python launcher, then explain the capability. */ }
  }
  return unavailable;
}
