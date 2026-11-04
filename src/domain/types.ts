export type Network = "mainnet" | "devnet";
export type Program = "spl-token" | "token-2022";
export interface Extension {
  type: number;
  name: string;
  bytes: number;
  interpreted: boolean;
}
export interface TokenAccount {
  mint: string;
  owner: string;
  amountRaw: string;
  delegate: string | null;
  allowanceRaw: string;
  closeAuthority: string | null;
  effectiveCloseAuthority: string;
  state: "initialized" | "frozen";
  native: boolean;
  extensions: Extension[];
}
export interface Mint {
  decimals: number;
  freezeAuthority: string | null;
  permanentDelegate: string | null;
  extensions: Extension[];
}
export interface AccountRow extends TokenAccount {
  address: string;
  program: Program;
  slot: number;
  mintSlot: number | null;
  mintRead: "verified" | "unavailable";
  mintInfo: Mint | null;
  amount: string | null;
  allowance: string | null;
  notes: string[];
}
export interface Issue {
  code: string;
  message: string;
  address?: string;
  program?: Program;
}
export interface ProgramRead {
  program: Program;
  status: "read" | "unavailable";
  slot: number | null;
  returned: number;
}
export interface Inspection {
  schemaVersion: 1;
  source: "rpc" | "example";
  example: string | null;
  wallet: string;
  network: Network;
  observedAt: string;
  commitment: "confirmed";
  status: "complete" | "partial";
  programs: ProgramRead[];
  accounts: AccountRow[];
  issues: Issue[];
  summary: {
    accounts: number;
    delegatedAccounts: number;
    nonzeroAllowances: number;
    permanentDelegateAccounts: number;
    externalCloseAuthorities: number;
    frozenAccounts: number;
  };
  limits: { accountsPerProgram: number; mints: number };
  scope: string[];
}
export interface RawAccount {
  owner: string;
  executable: boolean;
  data: Buffer;
}
export interface ListedAccount extends RawAccount {
  address: string;
}
export interface Reader {
  tokenAccounts(
    wallet: string,
    program: Program,
    minSlot?: number,
  ): Promise<{ slot: number; accounts: ListedAccount[] }>;
  mints(
    addresses: string[],
    minSlot: number,
  ): Promise<{ slot: number; accounts: (RawAccount | null)[] }>;
}
