import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { example } from "../src/examples.js";
import { parseCommand } from "../src/commands.js";
import { markdown } from "../src/domain/report.js";
import { key } from "./helpers/accounts.js";
import { InspectorError } from "../src/domain/errors.js";
test("offline examples use the real decoder and preserve source labels in exports", async () => {
  const r = await example("review");
  assert(r);
  assert.equal(r.source, "example");
  assert(r.summary.nonzeroAllowances > 0);
  assert(r.summary.permanentDelegateAccounts > 0);
  assert(r.summary.frozenAccounts > 0);
  const exported = markdown(r);
  assert(exported.includes("Fictional offline example"));
  assert(exported.includes(r.wallet));
  assert(exported.includes("not a wallet safety verdict"));
  assert.equal((await example("empty"))?.accounts.length, 0);
  assert.equal(await example("not-real"), undefined);
});
test("health and examples are offline; security headers prevent remote content", async () => {
  const app = createApp({
    inspect: async () => {
      throw new Error("RPC should not be called");
    },
  });
  const health = await request(app).get("/api/health");
  assert.equal(health.status, 200);
  assert(
    String(health.headers["content-security-policy"]).includes(
      "default-src 'self'",
    ),
  );
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  const list = await request(app).get("/api/examples");
  assert.equal(list.status, 200);
  assert.equal(list.body.examples.length, 4);
  const demo = await request(app).get("/api/examples/review");
  assert.equal(demo.status, 200);
  assert.equal(demo.body.source, "example");
  assert.equal((await request(app).get("/api/examples/missing")).status, 404);
});
test("validate wallet, network and unknown fields before doing any live reads", async () => {
  let count = 0;
  const app = createApp({
    inspect: async () => {
      count++;
      return (await example("empty"))!;
    },
  });
  for (const body of [
    { wallet: "bad", network: "devnet" },
    { wallet: key(1), network: "localhost" },
    { wallet: key(1), network: "devnet", rpcUrl: "http://169.254.169.254" },
  ])
    assert.equal(
      (await request(app).post("/api/inspections").send(body)).status,
      400,
    );
  assert.equal(count, 0);
  const r = await request(app)
    .post("/api/inspections")
    .send({ wallet: key(1), network: "devnet" });
  assert.equal(r.status, 200);
  assert.equal(count, 1);
});
test("reject foreign Origin, cross-site requests and DNS rebinding Hosts", async () => {
  const app = createApp();
  assert.equal(
    (await request(app).get("/api/health").set("Host", "attacker.example"))
      .status,
    421,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/inspections")
        .set("Origin", "https://attacker.example")
        .send({ wallet: key(1), network: "devnet" })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .get("/api/examples")
        .set("Sec-Fetch-Site", "cross-site")
    ).status,
    403,
  );
});
test("JSON boundaries reject oversized, malformed and non-JSON requests", async () => {
  const app = createApp();
  assert.equal(
    (
      await request(app)
        .post("/api/inspections")
        .set("Content-Type", "application/json")
        .send("{")
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/inspections")
        .send({ wallet: "a".repeat(4000), network: "devnet" })
    ).status,
    413,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/inspections")
        .type("form")
        .send({ wallet: key(1) })
    ).status,
    415,
  );
  assert.equal((await request(app).get("/api/inspections")).status, 405);
});
test("RPC failures retain structured status without leaking stack traces", async () => {
  const app = createApp({
    inspect: async () => {
      throw new InspectorError("RPC_RATE_LIMIT", "Retry later.", 429);
    },
  });
  const r = await request(app)
    .post("/api/inspections")
    .send({ wallet: key(1), network: "mainnet" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "RPC_RATE_LIMIT");
  assert.equal(r.body.error.stack, undefined);
  const broken = createApp({
    inspect: async () => {
      throw new Error("secret implementation detail");
    },
  });
  const fail = await request(broken)
    .post("/api/inspections")
    .send({ wallet: key(1), network: "mainnet" });
  assert.equal(fail.status, 500);
  assert(!JSON.stringify(fail.body).includes("secret implementation"));
});
test("bound local request rate before calling RPC", async () => {
  let count = 0;
  const app = createApp({
    maxLookupsPerMinute: 1,
    inspect: async () => {
      count++;
      return (await example("empty"))!;
    },
  });
  const body = { wallet: key(1), network: "devnet" };
  assert.equal(
    (await request(app).post("/api/inspections").send(body)).status,
    200,
  );
  assert.equal(
    (await request(app).post("/api/inspections").send(body)).status,
    429,
  );
  assert.equal(count, 1);
});
test("CLI validates flags and positional input without starting a server or RPC", () => {
  assert.deepEqual(parseCommand([]), { kind: "server", port: 4480 });
  assert.deepEqual(parseCommand([key(1), "--network", "devnet", "--json"]), {
    kind: "inspect",
    wallet: key(1),
    network: "devnet",
    json: true,
  });
  assert.deepEqual(parseCommand(["--example", "review", "--json"]), {
    kind: "example",
    id: "review",
    json: true,
  });
  for (const args of [
    ["bad"],
    ["--json"],
    ["--port", "0"],
    ["--port", "4480garbage"],
    ["--example", "missing"],
    [key(1), "--port", "4490"],
    [key(1), key(2)],
    ["--network", "wrong"],
    ["--example", "review", key(1)],
  ])
    assert.throws(() => parseCommand(args));
});

test("cross-origin checks allow the exact local origin and reject null or another port", async () => {
  const app = createApp();
  const ok = await request(app)
    .get("/api/health")
    .set("Host", "localhost:4480")
    .set("Origin", "http://localhost:4480");
  assert.equal(ok.status, 200);
  for (const origin of [
    "null",
    "http://localhost:4481",
    "http://127.0.0.1:4480",
    "https://localhost:4480",
  ])
    assert.equal(
      (
        await request(app)
          .get("/api/health")
          .set("Host", "localhost:4480")
          .set("Origin", origin)
      ).status,
      403,
    );
});
test("concurrent inspections are bounded and a completed request frees its slot", async () => {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let both!: () => void;
  const two = new Promise<void>((resolve) => {
    both = resolve;
  });
  const app = createApp({
    inspect: async () => {
      started++;
      if (started === 2) both();
      await gate;
      return (await example("empty"))!;
    },
  });
  const run = () =>
    request(app)
      .post("/api/inspections")
      .send({ wallet: key(1), network: "devnet" })
      .then((r) => r.status);
  const first = run(),
    second = run();
  await two;
  try {
    assert.equal(await run(), 429);
  } finally {
    release();
  }
  assert.deepEqual(await Promise.all([first, second]), [200, 200]);
  assert.equal(await run(), 200);
});
test("minute rate window expires without accumulating unbounded history", async () => {
  let now = 0;
  const app = createApp({
    now: () => now,
    maxLookupsPerMinute: 1,
    inspect: async () => (await example("empty"))!,
  });
  const run = () =>
    request(app)
      .post("/api/inspections")
      .send({ wallet: key(1), network: "devnet" });
  assert.equal((await run()).status, 200);
  assert.equal((await run()).status, 429);
  now = 60001;
  assert.equal((await run()).status, 200);
});
