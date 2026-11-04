#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseCommand } from "./commands.js";
import { example } from "./examples.js";
import { inspectWallet } from "./services/inspect.js";
import { markdown } from "./domain/report.js";
import { InspectorError } from "./domain/errors.js";
try {
  const command = parseCommand(process.argv.slice(2));
  if (command.kind === "help")
    console.log(`delegate? | Solana token-account permission inspector

Usage: delegate-inspector [PUBLIC_ADDRESS] [--network mainnet|devnet] [--json]
       delegate-inspector --example review|plain|partial|empty [--json]
       delegate-inspector [--port 4480]

No address starts the loopback dashboard. Examples use fictional data, without RPC.
Read-only: no wallet connection, signing, transactions or saved history.
--help, -h     Show this help
--version      Show the installed version
Exit: 0 report (including labeled partial reads), 1 lookup failure, 2 usage/server error.`);
  else if (command.kind === "version") {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    console.log(pkg.version);
  } else if (command.kind === "inspect" || command.kind === "example") {
    const report =
      command.kind === "example"
        ? await example(command.id)
        : await inspectWallet(command.wallet, command.network);
    if (!report) throw new Error("Unknown example.");
    process.stdout.write(
      command.json ? JSON.stringify(report, null, 2) + "\n" : markdown(report),
    );
  } else {
    const { createApp } = await import("./app.js");
    const server = createApp().listen(command.port, "127.0.0.1", () =>
      console.log(
        `delegate? → http://127.0.0.1:${command.port}\nRead-only local dashboard. Press Ctrl+C to stop.`,
      ),
    );
    server.on("error", (error) => {
      console.error(
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? "Port is already in use. Choose --port PORT."
          : "Could not start the local dashboard.",
      );
      process.exitCode = 2;
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        server.closeAllConnections();
        server.close();
      });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Inspection failed.");
  process.exitCode = error instanceof InspectorError ? 1 : 2;
}
