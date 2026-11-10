import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Obsidian loads a single `styles.css` from the plugin root. We keep the CSS
// split into readable partials under `styles/` and concatenate them — in
// numeric filename order — into that one file. Theme modules under
// `styles/themes/<name>/` come last, so a theme overrides the shared layers.

const root = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.join(root, "styles");
const outFile = path.join(root, "styles.css");

const cssIn = async (dir) =>
  (await fs.readdir(dir))
    .filter((f) => f.endsWith(".css"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((f) => path.join(dir, f));

export async function buildCss() {
  const themesDir = path.join(stylesDir, "themes");
  const themes = await fs
    .readdir(themesDir, { withFileTypes: true })
    .then((d) => d.filter((e) => e.isDirectory()).map((e) => e.name).sort())
    .catch(() => []);
  // Order: tokens (00-*), UI primitive shapes (ui/), the rest of styles/, then theme modules.
  const top = await cssIn(stylesDir);
  const tokens = top.filter((f) => path.basename(f).startsWith("00-"));
  const ui = await cssIn(path.join(stylesDir, "ui")).catch(() => []);
  const files = [...tokens, ...ui, ...top.filter((f) => !tokens.includes(f))];
  for (const t of themes) files.push(...(await cssIn(path.join(themesDir, t))));
  const entries = files.map((f) => path.relative(stylesDir, f));

  const parts = [];
  for (const file of files) {
    parts.push(await fs.readFile(file, "utf8"));
  }

  // Join with a blank line; partials already end in newlines, so trim the
  // seams to avoid runaway blank lines, then end with a single trailing newline.
  const css = parts.map((p) => p.replace(/\s+$/, "")).join("\n\n") + "\n";
  await fs.writeFile(outFile, css);
  return entries;
}

// Allow running directly: `node build-css.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await buildCss();
  console.log(`styles.css ← ${files.join(", ")}`);
}
