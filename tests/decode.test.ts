import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTokenAccount,
  decodeMint,
  formatUnits,
  isAddress,
} from "../src/domain/decode.js";
import {
  accountBytes,
  mintBytes,
  key,
  tlv,
  TOKEN,
  TOKEN2022,
} from "./helpers/accounts.js";

test("decode a delegate, exact u64 allowance, external close authority and frozen state", () => {
  const a = decodeTokenAccount(
    accountBytes({
      delegate: key(3),
      allowance: 18446744073709551615n,
      close: key(4),
      frozen: true,
    }),
    TOKEN,
  );
  assert.equal(a.owner, key(1));
  assert.equal(a.delegate, key(3));
  assert.equal(a.allowanceRaw, "18446744073709551615");
  assert.equal(a.closeAuthority, key(4));
  assert.equal(a.state, "frozen");
});
test("an absent close authority falls back to the token account owner", () => {
  const a = decodeTokenAccount(accountBytes(), TOKEN);
  assert.equal(a.delegate, null);
  assert.equal(a.closeAuthority, null);
  assert.equal(a.effectiveCloseAuthority, key(1));
});
test("zero allowance does not erase a delegate address", () => {
  const a = decodeTokenAccount(accountBytes({ delegate: key(3) }), TOKEN);
  assert.equal(a.delegate, key(3));
  assert.equal(a.allowanceRaw, "0");
});
test("base-unit formatting never passes through floating point", () => {
  assert.equal(formatUnits("18446744073709551615", 9), "18446744073.709551615");
  assert.equal(formatUnits("1", 6), "0.000001");
  assert.equal(formatUnits("0", 255), "0");
  assert.equal(formatUnits("1000000", 6), "1");
});
test("public addresses are exactly 32 bytes, including PDAs", () => {
  assert.equal(isAddress(key(1)), true);
  assert.equal(isAddress("11111111111111111111111111111111"), true);
  for (const s of ["", "0OIl", key(1) + key(1), "[1,2,3]"])
    assert.equal(isAddress(s), false);
});
test("reject bad program, size, state, and COption discriminators", () => {
  assert.throws(() => decodeTokenAccount(accountBytes(), key(9)));
  assert.throws(() => decodeTokenAccount(Buffer.alloc(82), TOKEN));
  for (const offset of [72, 109, 129]) {
    const b = accountBytes();
    b.writeUInt32LE(2, offset);
    assert.throws(() => decodeTokenAccount(b, TOKEN));
  }
  for (const state of [0, 3, 255]) {
    const b = accountBytes();
    b[108] = state;
    assert.throws(() => decodeTokenAccount(b, TOKEN));
  }
});
test("Token-2022 account discriminator and unknown extensions are preserved", () => {
  const a = decodeTokenAccount(
    accountBytes({
      extensions: [tlv(7, Buffer.alloc(0)), tlv(60000, Buffer.from([1, 2]))],
    }),
    TOKEN2022,
  );
  assert.deepEqual(
    a.extensions.map((e) => e.type),
    [7, 60000],
  );
  assert.equal(a.extensions[1]?.interpreted, false);
  const b = accountBytes({ extensions: [] });
  b[165] = 1;
  assert.throws(() => decodeTokenAccount(b, TOKEN2022));
});
test("reject duplicate, truncated TLV, multisig size and nonzero invalid padding", () => {
  for (const b of [
    accountBytes({
      extensions: [tlv(7, Buffer.alloc(0)), tlv(7, Buffer.alloc(0))],
    }),
    Buffer.concat([
      accountBytes({ extensions: [] }),
      Buffer.from([12, 0, 32, 0, 1]),
    ]),
    Buffer.alloc(355),
  ])
    assert.throws(() => decodeTokenAccount(b, TOKEN2022));
  const b = mintBytes({ permanent: key(3) });
  b[82] = 1;
  assert.throws(() => decodeMint(b, TOKEN2022));
});
test("permanent delegate is read from the mint, not from token-account delegate", () => {
  const m = decodeMint(
    mintBytes({ permanent: key(5), freeze: key(6) }),
    TOKEN2022,
  );
  assert.equal(m.permanentDelegate, key(5));
  assert.equal(m.freezeAuthority, key(6));
  assert.equal(m.decimals, 6);
  assert.equal(decodeMint(mintBytes(), TOKEN).permanentDelegate, null);
});
test("unset permanent delegate and malformed permanent delegate are distinct", () => {
  assert.equal(
    decodeMint(
      mintBytes({ extensions: [tlv(12, Buffer.alloc(32))] }),
      TOKEN2022,
    ).permanentDelegate,
    null,
  );
  assert.throws(() =>
    decodeMint(
      mintBytes({ extensions: [tlv(12, Buffer.alloc(31))] }),
      TOKEN2022,
    ),
  );
});
