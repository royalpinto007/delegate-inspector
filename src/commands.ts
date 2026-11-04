import { parseArgs } from "node:util";
import { isAddress } from "./domain/decode.js";
import { EXAMPLES } from "./examples.js";
import type { Network } from "./domain/types.js";
export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "server"; port: number }
  | { kind: "inspect"; wallet: string; network: Network; json: boolean }
  | { kind: "example"; id: string; json: boolean };
export function parseCommand(
  args: string[],
  portEnv = process.env.PORT,
): Command {
  const { values: v, positionals: p } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      network: { type: "string", default: "mainnet" },
      example: { type: "string" },
      json: { type: "boolean" },
      port: { type: "string" },
    },
  });
  if (v.help) return { kind: "help" };
  if (v.version) return { kind: "version" };
  if (p.length > 1 || !["mainnet", "devnet"].includes(v.network!))
    throw new Error(
      "Use one public address and --network mainnet|devnet. Run --help for examples.",
    );
  if (v.example) {
    if (p.length || v.port || !EXAMPLES.some((e) => e.id === v.example))
      throw new Error(
        "Choose --example review|plain|partial|empty without an address or --port.",
      );
    return { kind: "example", id: v.example, json: !!v.json };
  }
  if (p[0]) {
    if (!isAddress(p[0]) || v.port)
      throw new Error(
        "Provide a valid public Solana address. --port is for the dashboard only.",
      );
    return {
      kind: "inspect",
      wallet: p[0],
      network: v.network as Network,
      json: !!v.json,
    };
  }
  if (v.json)
    throw new Error("Provide an address or --example for JSON output.");
  const port = v.port ?? portEnv ?? "4480";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Port must be an integer from 1 to 65535.");
  return { kind: "server", port: Number(port) };
}
