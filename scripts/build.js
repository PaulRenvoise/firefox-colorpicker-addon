import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("extension", "dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.js", content: "src/content/index.js", settings: "src/settings-page.js" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "firefox140",
  loader: { ".css": "text" },
  legalComments: "none",
});
