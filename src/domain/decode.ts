import bs58 from "bs58";
import type { Extension, Mint, TokenAccount, Program } from "./types.js";
export const PROGRAMS: Record<Program, string> = {
  "spl-token": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "token-2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
};
export { isAddress } from "./address.js";
const nonzero = (b: Buffer) => b.some((v) => v !== 0);
const publicKey = (b: Buffer, offset: number) =>
  bs58.encode(b.subarray(offset, offset + 32));
function option(b: Buffer, offset: number): boolean {
  const value = b.readUInt32LE(offset);
  if (value > 1) throw new Error("Invalid token COption discriminator.");
  return value === 1;
}
const EXTENSIONS: Record<number, string> = {
  1: "TransferFeeConfig",
  2: "TransferFeeAmount",
  3: "MintCloseAuthority",
  4: "ConfidentialTransferMint",
  5: "ConfidentialTransferAccount",
  6: "DefaultAccountState",
  7: "ImmutableOwner",
  8: "MemoTransfer",
  9: "NonTransferable",
  10: "InterestBearingConfig",
  11: "CpiGuard",
  12: "PermanentDelegate",
  13: "NonTransferableAccount",
  14: "TransferHook",
  15: "TransferHookAccount",
  18: "MetadataPointer",
  19: "TokenMetadata",
  20: "GroupPointer",
  21: "TokenGroup",
  22: "GroupMemberPointer",
  23: "TokenGroupMember",
  25: "ScaledUiAmountConfig",
  26: "PausableConfig",
  27: "PausableAccount",
  28: "PermissionedBurn",
};
function extensions(
  data: Buffer,
  owner: string,
  kind: "mint" | "account",
): { entries: Extension[]; permanentDelegate: string | null } {
  const base = kind === "mint" ? 82 : 165;
  if (owner !== PROGRAMS["spl-token"] && owner !== PROGRAMS["token-2022"])
    throw new Error("Unexpected token program owner.");
  if (data.length > 65536)
    throw new Error("Account exceeds the 64 KiB decoding limit.");
  if (owner === PROGRAMS["spl-token"] && data.length !== base)
    throw new Error("Invalid legacy token account size.");
  const entries: Extension[] = [];
  let permanentDelegate: string | null = null;
  if (data.length === base) return { entries, permanentDelegate };
  if (
    data.length < 166 ||
    data.length === 355 ||
    data[165] !== (kind === "mint" ? 1 : 2) ||
    (kind === "mint" && nonzero(data.subarray(82, 165)))
  )
    throw new Error("Invalid Token-2022 extension account header.");
  let offset = 166;
  const seen = new Set<number>();
  while (offset < data.length) {
    if (!nonzero(data.subarray(offset))) break;
    if (offset + 4 > data.length)
      throw new Error("Truncated extension header.");
    const type = data.readUInt16LE(offset),
      length = data.readUInt16LE(offset + 2);
    offset += 4;
    if (type === 0 || seen.has(type) || offset + length > data.length)
      throw new Error("Malformed or duplicate extension.");
    seen.add(type);
    let interpreted = false;
    if (kind === "mint" && type === 12) {
      if (length !== 32) throw new Error("Invalid permanent delegate size.");
      const value = data.subarray(offset, offset + length);
      permanentDelegate = nonzero(value) ? bs58.encode(value) : null;
      interpreted = true;
    }
    if (kind === "account" && type === 7) {
      if (length !== 0) throw new Error("Invalid immutable owner size.");
      interpreted = true;
    }
    entries.push({
      type,
      name: EXTENSIONS[type] ?? `Unknown extension #${type}`,
      bytes: length,
      interpreted,
    });
    offset += length;
  }
  return { entries, permanentDelegate };
}
export function decodeTokenAccount(
  data: Buffer,
  programOwner: string,
): TokenAccount {
  if (data.length < 165) throw new Error("Token account data is too short.");
  const parsed = extensions(data, programOwner, "account");
  const state = data[108];
  if (state !== 1 && state !== 2)
    throw new Error(
      "Token account is not initialized or has an invalid state.",
    );
  const owner = publicKey(data, 32);
  const closeAuthority = option(data, 129) ? publicKey(data, 133) : null;
  return {
    mint: publicKey(data, 0),
    owner,
    amountRaw: data.readBigUInt64LE(64).toString(),
    delegate: option(data, 72) ? publicKey(data, 76) : null,
    allowanceRaw: data.readBigUInt64LE(121).toString(),
    closeAuthority,
    effectiveCloseAuthority: closeAuthority ?? owner,
    state: state === 2 ? "frozen" : "initialized",
    native: option(data, 109),
    extensions: parsed.entries,
  };
}
export function decodeMint(data: Buffer, programOwner: string): Mint {
  if (data.length < 82 || data[45] !== 1)
    throw new Error("Mint is not initialized or data is too short.");
  option(data, 0);
  const parsed = extensions(data, programOwner, "mint");
  return {
    decimals: data[44]!,
    freezeAuthority: option(data, 46) ? publicKey(data, 50) : null,
    permanentDelegate: parsed.permanentDelegate,
    extensions: parsed.entries,
  };
}
export function formatUnits(raw: string, decimals: number): string {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new Error("Invalid token units.");
  const digits = BigInt(raw).toString();
  if (decimals === 0 || digits === "0") return digits;
  const padded = digits.padStart(decimals + 1, "0");
  return (padded.slice(0, -decimals) + "." + padded.slice(-decimals))
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}
