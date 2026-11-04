import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRpcReader } from "../src/adapters/rpc.js";
import {
  key,
  accountBytes,
  mintBytes,
  rpcAccount,
  TOKEN,
} from "./helpers/accounts.js";
async function fixture(
  body: (request: Record<string, unknown>) => {
    status?: number;
    body: unknown;
  },
  fn: (
    reader: ReturnType<typeof createRpcReader>,
    requests: Record<string, unknown>[],
  ) => Promise<void>,
  options: { maxResponseBytes?: number } = {},
) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const data = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    requests.push(data);
    const result = body(data);
    res.writeHead(result.status ?? 200, { "Content-Type": "application/json" });
    res.end(
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert(addr && typeof addr === "object");
  const reader = createRpcReader("devnet", {
    ...options,
    fetchImpl: (_url, init) => fetch(`http://127.0.0.1:${addr.port}`, init),
  });
  try {
    await fn(reader, requests);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const envelope = (value: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  result: { context: { slot: 100 }, value },
});
test("real HTTP boundary sends only read methods and exact program, commitment and min slot", async () => {
  await fixture(
    (req) => ({
      body: envelope(
        req.method === "getTokenAccountsByOwner"
          ? [{ pubkey: key(3), account: rpcAccount(accountBytes()) }]
          : [rpcAccount(mintBytes())],
      ),
    }),
    async (reader, requests) => {
      const accounts = await reader.tokenAccounts(key(1), "spl-token", 99);
      assert.equal(accounts.accounts[0]?.address, key(3));
      assert(accounts.accounts[0]?.data.equals(accountBytes()));
      const mint = await reader.mints([key(2)], 100);
      assert(mint.accounts[0]?.data.equals(mintBytes()));
      assert.deepEqual(requests[0]?.params, [
        key(1),
        { programId: TOKEN },
        { encoding: "base64", commitment: "confirmed", minContextSlot: 99 },
      ]);
      assert.equal(requests[1]?.method, "getMultipleAccounts");
    },
  );
});
for (const [label, result, code] of [
  ["rate limit", { status: 429, body: {} }, "RPC_RATE_LIMIT"],
  ["HTTP failure", { status: 503, body: {} }, "RPC_UNAVAILABLE"],
  [
    "JSON-RPC error",
    {
      body: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32005, message: "private upstream detail" },
      },
    },
    "RPC_ERROR",
  ],
  ["malformed JSON", { body: "{" }, "RPC_INVALID_RESPONSE"],
  ["bad envelope", { body: { result: [] } }, "RPC_INVALID_RESPONSE"],
  ["unsafe slot", { body: envelope([]) }, "RPC_INVALID_RESPONSE"],
] as const) {
  test(`RPC ${label} becomes a typed error`, async () => {
    await fixture(
      () =>
        label === "unsafe slot"
          ? {
              body: {
                jsonrpc: "2.0",
                id: 1,
                result: {
                  context: { slot: "18446744073709551615" },
                  value: [],
                },
              },
            }
          : result,
      async (reader) => {
        await assert.rejects(
          reader.tokenAccounts(key(1), "spl-token"),
          (e) =>
            e instanceof Error &&
            "code" in e &&
            e.code === code &&
            !e.message.includes("private upstream detail"),
        );
      },
    );
  });
}
test("reject oversized bodies, stale context, invalid base64 and mismatched result lengths", async () => {
  await fixture(
    () => ({ body: envelope([]) }),
    async (reader) => {
      await assert.rejects(reader.tokenAccounts(key(1), "spl-token"));
    },
    { maxResponseBytes: 16 },
  );
  await fixture(
    () => ({ body: envelope([]) }),
    async (reader) => {
      await assert.rejects(reader.tokenAccounts(key(1), "spl-token", 101));
      await assert.rejects(reader.mints([key(2)], 100));
    },
  );
  await fixture(
    () => ({
      body: envelope([
        {
          pubkey: key(3),
          account: { ...rpcAccount(accountBytes()), data: ["!!!!", "base64"] },
        },
      ]),
    }),
    async (reader) => {
      await assert.rejects(reader.tokenAccounts(key(1), "spl-token"));
    },
  );
});
test("timeout covers response streaming and cancels the request", async () => {
  let cancelled = false;
  const reader = createRpcReader("mainnet", {
    timeoutMs: 20,
    fetchImpl: async (_url, init) => {
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              cancelled = true;
              controller.error(new DOMException("Aborted", "AbortError"));
            });
            controller.enqueue(new TextEncoder().encode('{"jsonrpc":'));
          },
        }),
      );
    },
  });
  await assert.rejects(
    reader.tokenAccounts(key(1), "spl-token"),
    (e) => e instanceof Error && "code" in e && e.code === "RPC_TIMEOUT",
  );
  assert.equal(cancelled, true);
});
