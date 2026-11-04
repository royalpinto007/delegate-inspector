import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const temp = await mkdtemp(join(tmpdir(), "delegate package "));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
      { encoding: "utf8" },
    ),
  )[0];
  const files = packed.files.map((f) => f.path);
  for (const name of [
    "dist/cli.js",
    "dist/public/index.html",
    "dist/public/app.js",
    "dist/public/styles.css",
    "dist/public/architecture.svg",
    "README.md",
    "LICENSE",
  ])
    if (!files.includes(name)) throw new Error(`Package missing ${name}`);
  if (
    files.some((name) =>
      /(^|\/)(?:node_modules|tests|test-results|\.env(?:\.[^/]*)?)(?:\/|$)|\.(?:pem|key|mp4)$/.test(
        name,
      ),
    )
  )
    throw new Error("Package includes non-product or secret files.");
  execFileSync("tar", ["-xzf", join(temp, packed.filename), "-C", temp]);
  const pkg = JSON.parse(
    await readFile(join(temp, "package/package.json"), "utf8"),
  );
  if (pkg.private !== true)
    throw new Error(
      "Keep this local package unpublished until explicitly requested.",
    );
  // Exercise the installed layout without a second dependency installation.
  const { symlink } = await import("node:fs/promises");
  await symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(temp, "package/node_modules"),
    "dir",
  );
  const output = execFileSync(
    process.execPath,
    [join(temp, "package/dist/cli.js"), "--example", "review", "--json"],
    { encoding: "utf8" },
  );
  const report = JSON.parse(output);
  if (
    report.source !== "example" ||
    report.accounts.length !== 3 ||
    report.summary.permanentDelegateAccounts !== 1
  )
    throw new Error("Packed CLI did not inspect its offline example.");
  console.log(
    `Package passed: ${files.length} product files; packed CLI, UI and examples verified. No publication.`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
