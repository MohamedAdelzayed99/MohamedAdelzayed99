import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { Program } from "@hightech/commission";

/** Replaceable clock so tests can fast-forward past the return window. */
export const clock = { now: () => new Date() };

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const bad = (code: string, msg: string) => new HttpError(400, code, msg);
export const notFound = (msg = "غير موجود") => new HttpError(404, "not_found", msg);
export const forbidden = (msg = "غير مسموح") => new HttpError(403, "forbidden", msg);

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function referralCode(prefix: "R" | "W"): string {
  let s = prefix;
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return s;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Normalise an Egyptian mobile number to +201XXXXXXXXX. */
export function normalizePhone(input: unknown): string {
  const digits = String(input ?? "").replace(/[^\d]/g, "")
    // Arabic-Indic digits are converted by the apps, but be lenient here too
    .replace(/^0020/, "").replace(/^20/, "").replace(/^0?/, "0");
  if (!/^01[0125]\d{8}$/.test(digits)) throw bad("invalid_phone", "رقم الموبايل غير صحيح");
  return `+2${digits}`;
}

export function maskPhone(phone: string): string {
  return phone.slice(0, 5) + "*****" + phone.slice(-3);
}

export function parseProgram(p: string): Program {
  if (p !== "retail" && p !== "wholesale") throw notFound();
  return p;
}

export function int(v: unknown, field: string, { min = 0 }: { min?: number } = {}): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw bad("invalid_" + field, `قيمة غير صحيحة: ${field}`);
  return n;
}

export function str(v: unknown, field: string, { max = 500, optional = false } = {}): string {
  if ((v === undefined || v === null || v === "") && optional) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) throw bad("invalid_" + field, `قيمة غير صحيحة: ${field}`);
  return v.trim();
}
