import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { watch } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCss } from "./build-css.mjs";

const prod = process.argv[2] === "production";

// Concatenate the CSS partials in styles/ into the single styles.css Obsidian loads.
await buildCss();

const context = await esbuild.context({
  entryPoints: ["main.tsx"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  // React ships a much slower development build unless NODE_ENV is "production".
  define: { "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development") },
  jsx: "automatic",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
  // Rebuild styles.css whenever a partial under styles/ changes.
  const stylesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "styles");
  watch(stylesDir, { persistent: true }, () => {
    void buildCss().then(() => console.log("styles.css rebuilt")).catch((e) => console.error(e));
  });
}
