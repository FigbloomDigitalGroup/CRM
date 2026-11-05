import { UnauthorizedError, ValidationError } from "../errors";
import { generateBackupCodes, hashBackupCode, normaliseBackupCode } from "./backupCodes";
import { hashToken, newToken, openSecret, sealSecret } from "./secretBox";
import { currentStep, generateTotpSecret, matchTotp, otpauthUri } from "./totp";

/**
 * The two-step logic (FIG-1134, B6.02), shared by tenant users and platform
 * admins. It knows nothing about which identity type it serves: that is the
 * `TwoStepStore` it is given (tenant tables via `adminDb`, platform tables via
 * the platform database role). All the rules are therefore the same for both.
 */
export interface StoredCredential {
  secretEncrypted: string;
  enabledAt: Date | null;
  lastUsedStep: number | null;
}

export type ChallengePurpose = "VERIFY" | "ENROL";

export interface StoredChallenge {
  id: string;
  subjectId: string;
  purpose: ChallengePurpose;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  place: string | null;
}

export interface TwoStepStore {
  getCredential(subjectId: string): Promise<StoredCredential | null>;
  /** Insert or replace the (not yet enabled) credential. */
  saveSecret(subjectId: string, secretEncrypted: string): Promise<void>;
  enable(subjectId: string): Promise<void>;
  /** Atomically records `step` as used, only if it is newer than the last one. False = replay. */
  advanceStep(subjectId: string, step: number): Promise<boolean>;
  /** Removes the credential and every backup code. */
  deleteCredential(subjectId: string): Promise<void>;
  replaceBackupCodes(subjectId: string, hashes: string[]): Promise<void>;
  /** Marks one unused code used; false when it does not exist or is already used. */
  consumeBackupCode(subjectId: string, hash: string): Promise<boolean>;
  countBackupCodes(subjectId: string): Promise<number>;
  createChallenge(input: {
    subjectId: string;
    purpose: ChallengePurpose;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
    place?: string | null;
  }): Promise<StoredChallenge>;
  findChallenge(tokenHash: string): Promise<StoredChallenge | null>;
  /** Adds one failed attempt, returns the new count. */
  addAttempt(challengeId: string): Promise<number>;
  /** Marks the challenge used, only if it is still unused; false = someone else got there first. */
  consumeChallenge(challengeId: string): Promise<boolean>;
  /** Ends every open challenge of the subject. */
  clearChallenges(subjectId: string): Promise<void>;
}

export const CHALLENGE_MINUTES = 10;
export const MAX_CHALLENGE_ATTEMPTS = 5;

export interface Enrolment {
  /** Shown once, for manual entry. */
  secret: string;
  /** For the QR code. */
  otpauthUri: string;
}

export function createTwoStepEngine(store: TwoStepStore) {
  async function enabledCredential(subjectId: string) {
    const credential = await store.getCredential(subjectId);
    return credential && credential.enabledAt ? credential : null;
  }

  /** Checks an authenticator code against the stored seed and burns the time step (replay protection). */
  async function checkAuthenticatorCode(subjectId: string, code: string, credential: StoredCredential): Promise<boolean> {
    const step = matchTotp(openSecret(credential.secretEncrypted), code);
    if (step === null) return false;
    if (credential.lastUsedStep !== null && step <= credential.lastUsedStep) return false;
    return store.advanceStep(subjectId, step);
  }

  return {
    store,

    async isEnabled(subjectId: string): Promise<boolean> {
      return (await enabledCredential(subjectId)) !== null;
    },

    async status(subjectId: string) {
      const credential = await enabledCredential(subjectId);
      return {
        enabled: credential !== null,
        enabledAt: credential?.enabledAt?.toISOString() ?? null,
        backupCodesRemaining: credential ? await store.countBackupCodes(subjectId) : 0,
      };
    },

    /** Starts (or restarts) enrolment: a fresh seed, stored encrypted and not yet enabled. Refused when two-step is already on. */
    async beginEnrolment(subjectId: string, accountName: string): Promise<Enrolment> {
      if (await enabledCredential(subjectId)) throw new ValidationError("Two-step sign-in is already on. Turn it off first to enrol a new device.");
      const secret = generateTotpSecret();
      await store.saveSecret(subjectId, sealSecret(secret));
      return { secret, otpauthUri: otpauthUri(secret, accountName) };
    },

    /** Confirms enrolment with a first code, turns two-step on and returns the backup codes (the only time they are shown). */
    async confirmEnrolment(subjectId: string, code: string): Promise<{ backupCodes: string[] } | null> {
      const credential = await store.getCredential(subjectId);
      if (!credential || credential.enabledAt) return null;
      if (!(await checkAuthenticatorCode(subjectId, code, credential))) return null;
      await store.enable(subjectId);
      const backupCodes = generateBackupCodes();
      await store.replaceBackupCodes(subjectId, backupCodes.map(hashBackupCode));
      return { backupCodes };
    },

    /** An authenticator code for an enabled credential. */
    async verifyCode(subjectId: string, code: string): Promise<boolean> {
      const credential = await enabledCredential(subjectId);
      if (!credential) return false;
      return checkAuthenticatorCode(subjectId, code, credential);
    },

    /** A single-use backup code. Returns how many remain, or null when it did not match. */
    async useBackupCode(subjectId: string, input: string): Promise<{ remaining: number } | null> {
      if (!(await enabledCredential(subjectId))) return null;
      const canonical = normaliseBackupCode(input);
      if (!canonical) return null;
      if (!(await store.consumeBackupCode(subjectId, hashBackupCode(canonical)))) return null;
      return { remaining: await store.countBackupCodes(subjectId) };
    },

    /** Either kind of code. Backup codes are 10 letters/digits, authenticator codes 6 digits. */
    async verifyAnyCode(subjectId: string, input: string): Promise<{ method: "totp" | "backup"; backupCodesRemaining?: number } | null> {
      const trimmed = input.trim();
      if (/^\d[\d\s]{4,}$/.test(trimmed)) {
        return (await this.verifyCode(subjectId, trimmed)) ? { method: "totp" } : null;
      }
      const used = await this.useBackupCode(subjectId, trimmed);
      return used ? { method: "backup", backupCodesRemaining: used.remaining } : null;
    },

    /** Replaces every backup code (the old ones stop working). The caller has already verified the person. */
    async regenerateBackupCodes(subjectId: string): Promise<string[]> {
      if (!(await enabledCredential(subjectId))) throw new ValidationError("Two-step sign-in is not on.");
      const codes = generateBackupCodes();
      await store.replaceBackupCodes(subjectId, codes.map(hashBackupCode));
      return codes;
    },

    /** Removes two-step entirely (seed, backup codes, open challenges). The caller has already verified the person or the admin. */
    async disable(subjectId: string): Promise<void> {
      await store.deleteCredential(subjectId);
      await store.clearChallenges(subjectId);
    },

    // ---- challenges: a password-verified sign-in waiting for its second step ----

    async issueChallenge(
      subjectId: string,
      purpose: ChallengePurpose,
      client: { userAgent?: string | null; ipAddress?: string | null; place?: string | null } = {},
    ): Promise<{ token: string; expiresAt: Date }> {
      await store.clearChallenges(subjectId); // one open challenge per person: a new sign-in replaces the old one
      const token = newToken();
      const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
      await store.createChallenge({ subjectId, purpose, tokenHash: hashToken(token), expiresAt, ...client });
      return { token, expiresAt };
    },

    /** The open challenge behind a token, or an UnauthorizedError (unknown, used, expired or out of attempts: all the same answer). */
    async loadChallenge(token: string | undefined | null, purpose?: ChallengePurpose): Promise<StoredChallenge> {
      const gone = () => new UnauthorizedError("This sign-in has expired. Sign in again.");
      if (!token) throw gone();
      const challenge = await store.findChallenge(hashToken(token));
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) throw gone();
      if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) throw gone();
      if (purpose && challenge.purpose !== purpose) throw gone();
      return challenge;
    },

    /**
     * Counts an attempt BEFORE the code is checked, atomically (the database
     * increments and returns the new value), so parallel guesses cannot all slip
     * past the cap that loadChallenge checked. Past the cap: same "expired" answer.
     */
    async reserveAttempt(challenge: StoredChallenge): Promise<{ attemptsLeft: number }> {
      const attempts = await store.addAttempt(challenge.id);
      if (attempts > MAX_CHALLENGE_ATTEMPTS) throw new UnauthorizedError("This sign-in has expired. Sign in again.");
      return { attemptsLeft: Math.max(0, MAX_CHALLENGE_ATTEMPTS - attempts) };
    },

    /** A wrong code: counts against the challenge; at the limit the challenge is burned and the person signs in again. */
    async failChallenge(challenge: StoredChallenge): Promise<{ attemptsLeft: number }> {
      const attempts = await store.addAttempt(challenge.id);
      return { attemptsLeft: Math.max(0, MAX_CHALLENGE_ATTEMPTS - attempts) };
    },

    async completeChallenge(challenge: StoredChallenge): Promise<void> {
      if (!(await store.consumeChallenge(challenge.id))) throw new UnauthorizedError("This sign-in has expired. Sign in again.");
    },

    currentStep,
  };
}

export type TwoStepEngine = ReturnType<typeof createTwoStepEngine>;
