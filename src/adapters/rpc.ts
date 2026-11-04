import { z } from "zod";
import { InspectorError } from "../domain/errors.js";
import { isAddress, PROGRAMS } from "../domain/decode.js";
import type { Network, RawAccount, Reader } from "../domain/types.js";
const ENDPOINTS: Record<Network, string> = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};
const publicKey = z.string().refine(isAddress);
const rawAccount = z.object({
  owner: publicKey,
  executable: z.boolean(),
  data: z.tuple([z.string().max(87384), z.literal("base64")]),
});
const context = z.object({ slot: z.number().int().nonnegative().safe() });
const listed = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.object({
    context,
    value: z
      .array(z.object({ pubkey: publicKey, account: rawAccount }))
      .max(500),
  }),
});
const multiple = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.literal(1),
  result: z.object({ context, value: z.array(rawAccount.nullable()).max(50) }),
});
function decodeRaw(raw: z.infer<typeof rawAccount>): RawAccount {
  const encoded = raw.data[0];
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new Error("Invalid base64.");
  const data = Buffer.from(encoded, "base64");
  if (data.length > 65536 || data.toString("base64") !== encoded)
    throw new Error("Non-canonical or oversized account data.");
  return { data, owner: raw.owner, executable: raw.executable };
}
export interface RpcOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export function createRpcReader(
  network: Network,
  options: RpcOptions = {},
): Reader {
  const transport = options.fetchImpl ?? fetch;
  async function request(
    method: "getTokenAccountsByOwner" | "getMultipleAccounts",
    params: unknown[],
  ): Promise<unknown> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 6000);
    let response: Response | undefined;
    try {
      response = await transport(ENDPOINTS[network], {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: abort.signal,
        redirect: "error",
      });
      if (response.status === 429)
        throw new InspectorError(
          "RPC_RATE_LIMIT",
          "Public RPC rate limit reached. Wait a moment and retry.",
          429,
        );
      if (!response.ok)
        throw new InspectorError(
          "RPC_UNAVAILABLE",
          "Public RPC is unavailable. Retry later or switch networks.",
        );
      if (!response.body)
        throw new InspectorError(
          "RPC_INVALID_RESPONSE",
          "Public RPC returned an empty response.",
        );
      const max = options.maxResponseBytes ?? 4 * 1024 * 1024;
      const length = response.headers.get("content-length");
      if (length && Number(length) > max)
        throw new InspectorError(
          "RPC_RESPONSE_LIMIT",
          "RPC response exceeded the 4 MiB inspection limit. This scan is incomplete.",
        );
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > max)
            throw new InspectorError(
              "RPC_RESPONSE_LIMIT",
              "RPC response exceeded the inspection limit. This scan is incomplete.",
            );
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let json: unknown;
      try {
        // Retain unsafe integer lexemes before JSON.parse can round RPC metadata.
        json = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
          (_key: string, value: unknown, context?: { source?: string }) =>
            typeof value === "number" &&
            !Number.isSafeInteger(value) &&
            context?.source &&
            /^-?\d+$/.test(context.source)
              ? context.source
              : value,
        ) as unknown;
      } catch {
        throw new InspectorError(
          "RPC_INVALID_RESPONSE",
          "Public RPC returned unreadable JSON.",
        );
      }
      if (json && typeof json === "object" && "error" in json)
        throw new InspectorError(
          "RPC_ERROR",
          "Public RPC could not complete this read. Retry later or switch networks.",
        );
      return json;
    } catch (error) {
      if (abort.signal.aborted)
        throw new InspectorError(
          "RPC_TIMEOUT",
          "Public RPC timed out. Retry later or switch networks.",
          504,
        );
      if (error instanceof InspectorError) throw error;
      throw new InspectorError(
        "RPC_UNAVAILABLE",
        "Could not reach public RPC. Check your connection and retry.",
      );
    } finally {
      clearTimeout(timer);
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {});
    }
  }
  return {
    async tokenAccounts(wallet, program, minSlot = 0) {
      const value = await request("getTokenAccountsByOwner", [
        wallet,
        { programId: PROGRAMS[program] },
        {
          encoding: "base64",
          commitment: "confirmed",
          ...(minSlot ? { minContextSlot: minSlot } : {}),
        },
      ]);
      try {
        const parsed = listed.parse(value).result;
        if (parsed.context.slot < minSlot) throw new Error("Stale context.");
        return {
          slot: parsed.context.slot,
          accounts: parsed.value.map((row) => ({
            address: row.pubkey,
            ...decodeRaw(row.account),
          })),
        };
      } catch {
        throw new InspectorError(
          "RPC_INVALID_RESPONSE",
          "RPC account list could not be validated, exceeded 500 accounts, or had stale context.",
        );
      }
    },
    async mints(addresses, minSlot) {
      if (
        addresses.length < 1 ||
        addresses.length > 50 ||
        addresses.some((a) => !isAddress(a))
      )
        throw new InspectorError(
          "INVALID_BATCH",
          "Invalid mint read batch.",
          400,
        );
      const value = await request("getMultipleAccounts", [
        addresses,
        {
          encoding: "base64",
          commitment: "confirmed",
          minContextSlot: minSlot,
        },
      ]);
      try {
        const parsed = multiple.parse(value).result;
        if (
          parsed.context.slot < minSlot ||
          parsed.value.length !== addresses.length
        )
          throw new Error("Invalid context or result length.");
        return {
          slot: parsed.context.slot,
          accounts: parsed.value.map((row) => (row ? decodeRaw(row) : null)),
        };
      } catch {
        throw new InspectorError(
          "RPC_INVALID_RESPONSE",
          "RPC mint response could not be validated or had stale context.",
        );
      }
    },
  };
}
