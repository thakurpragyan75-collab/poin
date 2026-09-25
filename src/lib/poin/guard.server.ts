import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class PoinGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoinGuardError";
  }
}

const cache = new Map<string, { ok: boolean; at: number }>();
const TTL = 15_000;

export function isGuardError(error: unknown): boolean {
  return error instanceof Error && error.name === "PoinGuardError";
}

export function isPrivateAddress(ip: string): boolean {
  const raw = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (raw === "::1" || raw === "::") return true;
  if (raw.startsWith("fe80:") || raw.startsWith("fc") || raw.startsWith("fd")) return true;
  if (raw.startsWith("::ffff:")) return isPrivateAddress(raw.slice(7));
  const match = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function badHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h.endsWith(".internal") || h === "metadata.google.internal") return true;
  if (h.includes("%")) return true;
  return false;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PoinGuardError("That is not a URL Poin can open.");
  }
  if (url.username || url.password) {
    throw new PoinGuardError("URLs with embedded passwords are refused.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PoinGuardError("Only http and https sites can be hunted.");
  }
  if (badHost(url.hostname)) {
    throw new PoinGuardError("That host is private. Poin will not touch it.");
  }
  const host = url.hostname;
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new PoinGuardError("That address is private. Poin will not touch it.");
    }
    return url;
  }
  const hit = cache.get(host);
  const now = Date.now();
  if (hit && now - hit.at < TTL) {
    if (!hit.ok) throw new PoinGuardError("That host resolves to a private network.");
    return url;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new PoinGuardError("Poin could not resolve that host.");
  }
  const ok = records.length > 0 && records.every((r) => !isPrivateAddress(r.address));
  cache.set(host, { ok, at: now });
  if (!ok) throw new PoinGuardError("That host resolves to a private network.");
  return url;
}
