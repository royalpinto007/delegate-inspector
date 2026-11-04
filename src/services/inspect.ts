import { createRpcReader } from "../adapters/rpc.js";
import {
  decodeTokenAccount,
  decodeMint,
  formatUnits,
  isAddress,
  PROGRAMS,
} from "../domain/decode.js";
import { InspectorError } from "../domain/errors.js";
import type {
  AccountRow,
  Inspection,
  Issue,
  Mint,
  Network,
  Program,
  Reader,
} from "../domain/types.js";
const PROGRAM_ORDER: Program[] = ["spl-token", "token-2022"];
export const LIMITS = { accountsPerProgram: 500, mints: 100 };
export const SCOPE = [
  "This is a snapshot of current SPL Token and Token-2022 token accounts owned by the supplied address. It is not a wallet safety verdict.",
  "Only ordinary delegates, delegated amounts, close authority, frozen state, mint freeze authority and PermanentDelegate are interpreted. Other extensions are listed as unverified.",
  "Authority addresses may represent programs or multisigs. Signer thresholds, program behavior, staking, other program permissions and historical approvals are not inspected.",
  "Confirmed RPC reads use minimum context slots but are not an atomic snapshot. Public RPC sees the address you query. No wallet connection, signing or transactions.",
];
export async function inspectWallet(
  wallet: string,
  network: Network,
  options: { reader?: Reader } = {},
): Promise<Inspection> {
  if (!isAddress(wallet))
    throw new InspectorError(
      "INVALID_ADDRESS",
      "Enter a public Solana address. Never enter a private key or seed phrase.",
      400,
    );
  const reader = options.reader ?? createRpcReader(network);
  const issues: Issue[] = [],
    accounts: AccountRow[] = [],
    programs: Inspection["programs"] = [];
  const seen = new Set<string>();
  let minSlot = 0;
  let lastError: unknown;
  for (const program of PROGRAM_ORDER) {
    try {
      const result = await reader.tokenAccounts(wallet, program, minSlot);
      if (result.accounts.length > LIMITS.accountsPerProgram)
        throw new InspectorError(
          "ACCOUNT_LIMIT",
          "Account list exceeded the 500-account program limit.",
        );
      if (!Number.isSafeInteger(result.slot) || result.slot < minSlot)
        throw new Error("Stale RPC context.");
      minSlot = Math.max(minSlot, result.slot);
      programs.push({
        program,
        status: "read",
        slot: result.slot,
        returned: result.accounts.length,
      });
      for (const raw of result.accounts) {
        if (seen.has(raw.address)) {
          issues.push({
            code: "DUPLICATE_ACCOUNT",
            address: raw.address,
            program,
            message:
              "RPC returned a duplicate token account. It was not counted twice.",
          });
          continue;
        }
        seen.add(raw.address);
        try {
          if (
            !isAddress(raw.address) ||
            raw.executable ||
            raw.owner !== PROGRAMS[program]
          )
            throw new Error("Invalid token account owner or address.");
          const decoded = decodeTokenAccount(raw.data, raw.owner);
          if (decoded.owner !== wallet)
            throw new Error(
              "Token account authority does not match the requested address.",
            );
          const notes: string[] = [];
          if (decoded.state === "frozen")
            notes.push(
              "Frozen now: ordinary transfers and burns are blocked until thawed. Recorded permissions may still exist.",
            );
          if (decoded.delegate && decoded.allowanceRaw === "0")
            notes.push("A delegate is recorded with zero remaining allowance.");
          if (decoded.allowanceRaw !== "0" && !decoded.delegate)
            notes.push(
              "A nonzero delegated amount has no current delegate; it is not an active ordinary permission.",
            );
          if (decoded.effectiveCloseAuthority !== wallet)
            notes.push(
              "A different address is the effective close authority. This role alone does not grant token transfer permission.",
            );
          if (decoded.native)
            notes.push(
              "Wrapped SOL: closing this account can withdraw the underlying SOL even with a nonzero token balance. Review its effective close authority.",
            );
          if (decoded.extensions.some((e) => !e.interpreted))
            notes.push(
              "Some account extensions are not interpreted. Additional restrictions or permissions may apply.",
            );
          accounts.push({
            ...decoded,
            address: raw.address,
            program,
            slot: result.slot,
            mintSlot: null,
            mintRead: "unavailable",
            mintInfo: null,
            amount: null,
            allowance: null,
            notes,
          });
        } catch {
          issues.push({
            code: "INVALID_TOKEN_ACCOUNT",
            address: raw.address,
            program,
            message:
              "A token account could not be decoded or its authority/program did not match. It was excluded.",
          });
        }
      }
    } catch (error) {
      lastError = error;
      programs.push({
        program,
        status: "unavailable",
        slot: null,
        returned: 0,
      });
      issues.push({
        code:
          error instanceof InspectorError ? error.code : "PROGRAM_READ_FAILED",
        program,
        message:
          error instanceof InspectorError
            ? error.message
            : "This token program could not be inspected.",
      });
    }
  }
  if (programs.every((p) => p.status === "unavailable")) {
    if (lastError instanceof InspectorError) throw lastError;
    throw new InspectorError(
      "SCAN_UNAVAILABLE",
      "Neither token program could be inspected. Retry later or switch networks.",
    );
  }
  const mints = [...new Set(accounts.map((a) => a.mint))];
  const selected = mints.slice(0, LIMITS.mints);
  if (mints.length > LIMITS.mints)
    issues.push({
      code: "MINT_LIMIT",
      message:
        "Only the first 100 distinct mints were read. Remaining mint-level authorities and decimals are unverified.",
    });
  const results = new Map<
    string,
    { mint: Mint; slot: number; programOwner: string }
  >();
  for (let start = 0; start < selected.length; start += 50) {
    const batch = selected.slice(start, start + 50);
    try {
      const result = await reader.mints(batch, minSlot);
      if (
        result.accounts.length !== batch.length ||
        result.slot < minSlot ||
        !Number.isSafeInteger(result.slot)
      )
        throw new Error("Invalid mint read context.");
      for (let i = 0; i < batch.length; i++) {
        const address = batch[i]!,
          raw = result.accounts[i];
        try {
          if (!raw || raw.executable) throw new Error("Missing mint.");
          const mint = decodeMint(raw.data, raw.owner);
          results.set(address, {
            mint,
            slot: result.slot,
            programOwner: raw.owner,
          });
        } catch {
          issues.push({
            code: "MINT_UNAVAILABLE",
            address,
            message:
              "Mint data could not be read or decoded. Mint-level authority and decimal information are unverified.",
          });
        }
      }
    } catch {
      for (const address of batch)
        issues.push({
          code: "MINT_UNAVAILABLE",
          address,
          message:
            "Mint RPC read failed. Mint-level permissions and decimals remain unverified.",
        });
    }
  }
  for (const row of accounts) {
    const result = results.get(row.mint);
    if (result && result.programOwner === PROGRAMS[row.program]) {
      row.mintInfo = result.mint;
      row.mintSlot = result.slot;
      row.mintRead = "verified";
      row.amount = formatUnits(row.amountRaw, result.mint.decimals);
      row.allowance = formatUnits(row.allowanceRaw, result.mint.decimals);
      if (result.mint.permanentDelegate)
        row.notes.push(
          "A mint-level permanent delegate can authorize transfers and burns across accounts for this mint. Token-account owners cannot revoke it from their accounts.",
        );
      if (result.mint.freezeAuthority)
        row.notes.push(
          "The mint freeze authority can freeze or thaw token accounts.",
        );
      if (result.mint.extensions.some((e) => !e.interpreted))
        row.notes.push(
          "Some mint extensions are not interpreted. Displayed amounts use base decimals only; scaled or interest-bearing display amounts are not calculated.",
        );
    } else {
      row.notes.push(
        "Mint-level permissions and decimals are unverified. Amounts are shown in raw units.",
      );
      if (result)
        issues.push({
          code: "MINT_PROGRAM_MISMATCH",
          address: row.mint,
          program: row.program,
          message: "Mint program does not match the token account program.",
        });
    }
  }
  const partial =
    issues.length > 0 ||
    accounts.some(
      (a) =>
        a.mintRead === "unavailable" ||
        a.extensions.some((e) => !e.interpreted) ||
        a.mintInfo?.extensions.some((e) => !e.interpreted),
    );
  return {
    schemaVersion: 1,
    source: "rpc",
    example: null,
    wallet,
    network,
    observedAt: new Date().toISOString(),
    commitment: "confirmed",
    status: partial ? "partial" : "complete",
    programs,
    accounts,
    issues,
    summary: {
      accounts: accounts.length,
      delegatedAccounts: accounts.filter((a) => a.delegate !== null).length,
      nonzeroAllowances: accounts.filter(
        (a) => a.delegate && BigInt(a.allowanceRaw) > 0n,
      ).length,
      permanentDelegateAccounts: accounts.filter(
        (a) => a.mintInfo?.permanentDelegate,
      ).length,
      externalCloseAuthorities: accounts.filter(
        (a) => a.effectiveCloseAuthority !== wallet,
      ).length,
      frozenAccounts: accounts.filter((a) => a.state === "frozen").length,
    },
    limits: { ...LIMITS },
    scope: [...SCOPE],
  };
}
