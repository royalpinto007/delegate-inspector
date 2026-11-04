import bs58 from "bs58";
import { inspectWallet } from "./services/inspect.js";
import { PROGRAMS } from "./domain/decode.js";
import { InspectorError } from "./domain/errors.js";
import type { Inspection, Reader } from "./domain/types.js";
export const EXAMPLES = [
  {
    id: "review",
    title: "Permission review",
    description: "Delegates, permanent authority and a frozen account.",
  },
  {
    id: "plain",
    title: "No recorded delegates",
    description: "Ordinary accounts with no recorded delegates.",
  },
  {
    id: "partial",
    title: "Incomplete read",
    description: "A failed program read and unverified mint permissions.",
  },
  {
    id: "empty",
    title: "Empty snapshot",
    description: "Both programs read successfully, with no token accounts.",
  },
];
const key = (seed: number) => bs58.encode(Buffer.alloc(32, seed));
function token(
  mint: number,
  delegate: number | null,
  frozen = false,
  close: number | null = null,
  extended = false,
): Buffer {
  const b = Buffer.alloc(extended ? 166 : 165);
  Buffer.alloc(32, mint).copy(b);
  Buffer.alloc(32, 1).copy(b, 32);
  b.writeBigUInt64LE(125_000_000n, 64);
  if (delegate !== null) {
    b.writeUInt32LE(1, 72);
    Buffer.alloc(32, delegate).copy(b, 76);
    b.writeBigUInt64LE(40_000_000n, 121);
  }
  b[108] = frozen ? 2 : 1;
  if (close !== null) {
    b.writeUInt32LE(1, 129);
    Buffer.alloc(32, close).copy(b, 133);
  }
  if (extended) b[165] = 2;
  return b;
}
function mint(permanent = false): Buffer {
  const b = Buffer.alloc(permanent ? 202 : 82);
  b[44] = 6;
  b[45] = 1;
  b.writeUInt32LE(1, 46);
  Buffer.alloc(32, 8).copy(b, 50);
  if (permanent) {
    b[165] = 1;
    b.writeUInt16LE(12, 166);
    b.writeUInt16LE(32, 168);
    Buffer.alloc(32, 7).copy(b, 170);
  }
  return b;
}
export async function example(id: string): Promise<Inspection | undefined> {
  if (!EXAMPLES.some((e) => e.id === id)) return undefined;
  const reader: Reader = {
    async tokenAccounts(_wallet, program) {
      if (id === "partial" && program === "token-2022")
        throw new InspectorError(
          "RPC_UNAVAILABLE",
          "Fictional Token-2022 RPC outage.",
        );
      const owner = PROGRAMS[program];
      const rows =
        id === "empty"
          ? []
          : program === "spl-token"
            ? [
                {
                  address: key(20),
                  owner,
                  executable: false,
                  data: token(
                    2,
                    id === "plain" ? null : 3,
                    false,
                    id === "plain" ? null : 4,
                  ),
                },
                ...(id === "review"
                  ? [
                      {
                        address: key(21),
                        owner,
                        executable: false,
                        data: token(2, 5, true),
                      },
                    ]
                  : []),
              ]
            : [
                {
                  address: key(22),
                  owner,
                  executable: false,
                  data: token(6, null, false, null, true),
                },
              ];
      return {
        slot: program === "spl-token" ? 300000000 : 300000001,
        accounts: rows,
      };
    },
    async mints(addresses) {
      return {
        slot: 300000002,
        accounts: addresses.map((address) =>
          id === "partial"
            ? null
            : address === key(6)
              ? {
                  owner: PROGRAMS["token-2022"],
                  executable: false,
                  data: mint(id === "review"),
                }
              : {
                  owner: PROGRAMS["spl-token"],
                  executable: false,
                  data: mint(),
                },
        ),
      };
    },
  };
  const result = await inspectWallet(key(1), "devnet", { reader });
  return { ...result, source: "example", example: id };
}
