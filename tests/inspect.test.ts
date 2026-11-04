import assert from "node:assert/strict";
import test from "node:test";
import { inspectWallet } from "../src/services/inspect.js";
import type { Reader } from "../src/domain/types.js";
import { InspectorError } from "../src/domain/errors.js";
import {
  accountBytes,
  mintBytes,
  key,
  tlv,
  TOKEN,
  TOKEN2022,
} from "./helpers/accounts.js";
function reader(
  options: {
    failLegacy?: boolean;
    fail2022?: boolean;
    missingMint?: boolean;
    wrongOwner?: boolean;
    badAccount?: boolean;
    extra?: boolean;
    duplicate?: boolean;
  } = {},
): Reader {
  return {
    async tokenAccounts(_wallet, program) {
      if (
        (program === "spl-token" && options.failLegacy) ||
        (program === "token-2022" && options.fail2022)
      )
        throw new InspectorError("RPC_UNAVAILABLE", "Unavailable.");
      const data = accountBytes({
        owner: options.wrongOwner ? key(9) : key(1),
        delegate: key(3),
        allowance: 40000000n,
        close: key(4),
        extensions: program === "token-2022" ? [] : undefined,
      });
      const row = {
        address: key(program === "spl-token" ? 10 : 11),
        owner: program === "spl-token" ? TOKEN : TOKEN2022,
        executable: false,
        data: options.badAccount ? Buffer.alloc(1) : data,
      };
      return {
        slot: program === "spl-token" ? 100 : 101,
        accounts: options.duplicate ? [row, row] : [row],
      };
    },
    async mints(addresses, minSlot) {
      assert(minSlot >= 100);
      return {
        slot: 102,
        accounts: addresses.map(() =>
          options.missingMint
            ? null
            : {
                owner: TOKEN,
                executable: false,
                data: mintBytes({
                  extensions: options.extra
                    ? [tlv(60000, Buffer.alloc(0))]
                    : undefined,
                }),
              },
        ),
      };
    },
  };
}
test("successful scan summarizes permissions and close authority without a safety verdict", async () => {
  const r = await inspectWallet(key(1), "devnet", {
    reader: {
      ...reader(),
      tokenAccounts: async (_wallet, program) =>
        program === "token-2022"
          ? { slot: 101, accounts: [] }
          : reader().tokenAccounts(key(1), program),
    },
  });
  assert.equal(r.status, "complete");
  assert.equal(r.accounts[0]?.allowance, "40");
  assert.equal(r.summary.nonzeroAllowances, 1);
  assert.equal(r.summary.externalCloseAuthorities, 1);
  assert.equal(r.summary.permanentDelegateAccounts, 0);
  assert(!JSON.stringify(r).includes('"safe":'));
});
test("one failed program is partial, not an empty complete scan", async () => {
  const r = await inspectWallet(key(1), "mainnet", {
    reader: reader({ fail2022: true }),
  });
  assert.equal(r.status, "partial");
  assert.equal(r.programs[1]?.status, "unavailable");
  assert.equal(r.accounts.length, 1);
  assert(r.issues.length > 0);
});
test("both unavailable programs fail the lookup", async () => {
  await assert.rejects(
    inspectWallet(key(1), "mainnet", {
      reader: reader({ fail2022: true, failLegacy: true }),
    }),
  );
});
test("invalid owner and corrupt accounts are never trusted", async () => {
  for (const opts of [{ wrongOwner: true }, { badAccount: true }]) {
    const r = await inspectWallet(key(1), "devnet", { reader: reader(opts) });
    assert.equal(r.status, "partial");
    assert.equal(r.accounts.length, 0);
    assert(r.issues.length >= 1);
  }
});
test("missing mints retain raw allowances and explicitly unknown permission coverage", async () => {
  const r = await inspectWallet(key(1), "devnet", {
    reader: reader({ missingMint: true }),
  });
  assert.equal(r.status, "partial");
  assert.equal(r.accounts[0]?.mintRead, "unavailable");
  assert.equal(r.accounts[0]?.allowanceRaw, "40000000");
  assert.equal(r.accounts[0]?.allowance, null);
});
test("mint program ownership must match each token-account program", async () => {
  const r = await inspectWallet(key(1), "devnet", { reader: reader() });
  assert.equal(r.accounts[1]?.mintRead, "unavailable");
  assert.equal(r.status, "partial");
});
test("a Token-2022 mint permanent delegate is shown even when ordinary delegation is absent", async () => {
  const rpc: Reader = {
    async tokenAccounts(_w, program) {
      return {
        slot: 100,
        accounts:
          program === "spl-token"
            ? []
            : [
                {
                  address: key(10),
                  owner: TOKEN2022,
                  executable: false,
                  data: accountBytes({ extensions: [] }),
                },
              ],
      };
    },
    async mints() {
      return {
        slot: 101,
        accounts: [
          {
            owner: TOKEN2022,
            executable: false,
            data: mintBytes({ permanent: key(5) }),
          },
        ],
      };
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(r.summary.delegatedAccounts, 0);
  assert.equal(r.summary.permanentDelegateAccounts, 1);
  assert.equal(r.accounts[0]?.mintInfo?.permanentDelegate, key(5));
});
test("unknown mint extensions and duplicate accounts are explicit partial observations", async () => {
  const r = await inspectWallet(key(1), "devnet", {
    reader: reader({ duplicate: true }),
  });
  assert.equal(r.accounts.length, 2);
  assert.equal(r.status, "partial");
  assert(r.issues.some((i) => i.code === "DUPLICATE_ACCOUNT"));
});
test("empty successful reads are a complete scoped snapshot, not a safety verdict", async () => {
  const rpc: Reader = {
    async tokenAccounts() {
      return { slot: 100, accounts: [] };
    },
    async mints() {
      throw new Error("Must not read mints");
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(r.status, "complete");
  assert.equal(r.summary.accounts, 0);
});
test("invalid addresses fail before any RPC", async () => {
  await assert.rejects(
    inspectWallet("private key?", "devnet", { reader: reader() }),
  );
});

test("wrapped SOL close authority warning includes the underlying SOL", async () => {
  const data = accountBytes({ close: key(4) });
  data.writeUInt32LE(1, 109);
  data.writeBigUInt64LE(2039280n, 113);
  const rpc: Reader = {
    async tokenAccounts(_wallet, program) {
      return {
        slot: 100,
        accounts:
          program === "spl-token"
            ? [{ address: key(10), owner: TOKEN, executable: false, data }]
            : [],
      };
    },
    async mints() {
      return {
        slot: 101,
        accounts: [{ owner: TOKEN, executable: false, data: mintBytes() }],
      };
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(r.accounts[0]?.native, true);
  assert(r.accounts[0]?.notes.some((note) => note.includes("underlying SOL")));
});
test("mint reads are bounded and unrequested mint authorities stay unverified", async () => {
  let mintReads = 0;
  const keys = Array.from({ length: 101 }, (_, i) => key(i + 2));
  const rpc: Reader = {
    async tokenAccounts(_wallet, program) {
      return {
        slot: 100,
        accounts:
          program === "spl-token"
            ? keys.map((mint, i) => ({
                address: key(i + 110),
                owner: TOKEN,
                executable: false,
                data: accountBytes({ mint }),
              }))
            : [],
      };
    },
    async mints(addresses) {
      mintReads++;
      assert(addresses.length <= 50);
      return {
        slot: 101,
        accounts: addresses.map(() => ({
          owner: TOKEN,
          executable: false,
          data: mintBytes(),
        })),
      };
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(mintReads, 2);
  assert.equal(r.accounts.length, 101);
  assert.equal(r.accounts[100]?.mintRead, "unavailable");
  assert.equal(r.status, "partial");
  assert(r.issues.some((i) => i.code === "MINT_LIMIT"));
});
test("unknown mint extension is retained and marks coverage partial", async () => {
  const rpc: Reader = {
    async tokenAccounts(_w, program) {
      return {
        slot: 100,
        accounts:
          program === "spl-token"
            ? []
            : [
                {
                  address: key(10),
                  owner: TOKEN2022,
                  executable: false,
                  data: accountBytes({ extensions: [] }),
                },
              ],
      };
    },
    async mints() {
      return {
        slot: 101,
        accounts: [
          {
            owner: TOKEN2022,
            executable: false,
            data: mintBytes({ extensions: [tlv(60000, Buffer.from([3]))] }),
          },
        ],
      };
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(r.status, "partial");
  assert.equal(r.accounts[0]?.mintInfo?.extensions[0]?.type, 60000);
  assert.equal(r.accounts[0]?.mintInfo?.extensions[0]?.interpreted, false);
});
test("stale mint reads cannot create a false absence of authority", async () => {
  const rpc: Reader = {
    ...reader(),
    async mints(addresses) {
      return {
        slot: 99,
        accounts: addresses.map(() => ({
          owner: TOKEN,
          executable: false,
          data: mintBytes(),
        })),
      };
    },
  };
  const r = await inspectWallet(key(1), "devnet", { reader: rpc });
  assert.equal(r.status, "partial");
  assert(
    r.accounts.every(
      (a) => a.mintInfo === null && a.mintRead === "unavailable",
    ),
  );
});
