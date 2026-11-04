import bs58 from "bs58";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const key = (seed: number) => bs58.encode(Buffer.alloc(32, seed));
export function tlv(type: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(type);
  header.writeUInt16LE(value.length, 2);
  return Buffer.concat([header, value]);
}
export function accountBytes(
  options: {
    owner?: string;
    mint?: string;
    amount?: bigint;
    delegate?: string;
    allowance?: bigint;
    close?: string;
    frozen?: boolean;
    extensions?: Buffer[];
  } = {},
): Buffer {
  const b = Buffer.alloc(165);
  Buffer.from(bs58.decode(options.mint ?? key(2))).copy(b);
  Buffer.from(bs58.decode(options.owner ?? key(1))).copy(b, 32);
  b.writeBigUInt64LE(options.amount ?? 125_000_000n, 64);
  if (options.delegate) {
    b.writeUInt32LE(1, 72);
    Buffer.from(bs58.decode(options.delegate)).copy(b, 76);
  }
  b[108] = options.frozen ? 2 : 1;
  b.writeBigUInt64LE(options.allowance ?? 0n, 121);
  if (options.close) {
    b.writeUInt32LE(1, 129);
    Buffer.from(bs58.decode(options.close)).copy(b, 133);
  }
  return options.extensions
    ? Buffer.concat([b, Buffer.from([2]), ...options.extensions])
    : b;
}
export function mintBytes(
  options: {
    decimals?: number;
    permanent?: string;
    extensions?: Buffer[];
    freeze?: string;
  } = {},
): Buffer {
  const b = Buffer.alloc(82);
  b[44] = options.decimals ?? 6;
  b[45] = 1;
  if (options.freeze) {
    b.writeUInt32LE(1, 46);
    Buffer.from(bs58.decode(options.freeze)).copy(b, 50);
  }
  const extensions =
    options.extensions ??
    (options.permanent
      ? [tlv(12, Buffer.from(bs58.decode(options.permanent)))]
      : undefined);
  return extensions
    ? Buffer.concat([b, Buffer.alloc(83), Buffer.from([1]), ...extensions])
    : b;
}
export function rpcAccount(data: Buffer, program = TOKEN) {
  return {
    owner: program,
    executable: false,
    data: [data.toString("base64"), "base64"] as [string, "base64"],
  };
}
