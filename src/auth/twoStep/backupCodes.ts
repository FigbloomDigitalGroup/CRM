import { randomInt } from "node:crypto";
import { keyedHash } from "./secretBox";

/** Backup codes (FIG-1134): ten single-use codes shown once at enrolment. 10 characters from an unambiguous alphabet (about 50 bits each). */
export const BACKUP_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Whatever the person typed -> the canonical form (case, spaces and the dash do not matter). */
export function normaliseBackupCode(input: string): string | null {
  const clean = input.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length !== 10 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

export function hashBackupCode(canonical: string): string {
  return keyedHash("backup-code", canonical);
}
