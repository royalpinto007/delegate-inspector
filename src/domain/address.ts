import bs58 from "bs58";
export function isAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
