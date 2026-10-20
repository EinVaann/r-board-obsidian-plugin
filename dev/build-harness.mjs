// Bundle the dev harness (real UI + fake obsidian) into dev/out/ for a browser.
// Open dev/out/index.html (?kind=board for the notes board, ?factory for factory blocks, ?mobile for phone layout).
import esbuild from "esbuild";
import { copyFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildCss } from "../build-css.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dev/out");
await mkdir(out, { recursive: true });
await buildCss();

await esbuild.build({
  entryPoints: [path.join(root, "dev/harness.tsx")],
  bundle: true,
  outfile: path.join(out, "harness.js"),
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { obsidian: path.join(root, "dev/obsidian-browser.ts") },
  sourcemap: "inline",
  logLevel: "warning",
});

await copyFile(path.join(root, "styles.css"), path.join(out, "styles.css"));
await copyFile(path.join(root, "dev/theme.css"), path.join(out, "theme.css"));
await copyFile(path.join(root, "dev/sample.table"), path.join(out, "sample.table"));
for (const t of ["factory", "factory-items", "factory-transport"]) await copyFile(path.join(root, `dev/${t}.table`), path.join(out, `${t}.table`));
// A build stamp on the asset URLs keeps the browser from serving a stale bundle.
const v = Date.now();
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="styles.css?v=${v}"><link rel="stylesheet" href="theme.css?v=${v}"><title>R Board harness</title></head>
<body><div id="root"></div><script src="harness.js?v=${v}"></script></body></html>`,
);
console.log("dev/out ready");
