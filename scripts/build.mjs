import { build } from "esbuild";
import { mkdir, cp, chmod } from "node:fs/promises";
await mkdir("dist/public", { recursive: true });
await cp("public", "dist/public", { recursive: true });
await cp("docs/architecture.svg", "dist/public/architecture.svg");
await build({
  entryPoints: ["src/web/app.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "dist/public/app.js",
  target: "es2022",
});
await chmod("dist/cli.js", 0o755);
