import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform === "win32") {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("node-pty/package.json"));
  const source = join(root, "prebuilds", `win32-${process.arch}`, "conpty");
  // node-pty searches rebuilt addons before prebuilds, but electron-rebuild does not copy their DLLs.
  for (const configuration of ["Release", "Debug"]) {
    const target = join(root, "build", configuration);
    if (!existsSync(join(target, "conpty.node"))) continue;
    const destination = join(target, "conpty");
    mkdirSync(destination, { recursive: true });
    for (const file of ["conpty.dll", "OpenConsole.exe"]) {
      copyFileSync(join(source, file), join(destination, file));
    }
  }
}
