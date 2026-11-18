import { invalidateMeContext } from "./meContextCache";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import type { AuthContext } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getFileById, updateFileRecord } from "../repositories/files";
import { getStorageDriver } from "../storage";
import { FILE_POLICIES } from "../storage/policy";
import { diffAuditedFields } from "./auditDiff";
import { storeGeneratedFile } from "./fileService";

/**
 * The person's own profile and picture (FIG-1022, B1.06).
 *
 * Name, phone and time zone belong to the person (`users`); the picture
 * belongs to their seat in the organisation (`memberships`), because the
 * bytes live under the organisation's storage prefix and the organisation's
 * RLS. Management can see colleagues' names (the member list) but never
 * edits anyone else's profile; there is deliberately no endpoint for that.
 */

// ---------------------------------------------------------------------------
// Initials and avatar links
// ---------------------------------------------------------------------------

/** Up to two capital letters from the first and last word of a name; "?" when there is nothing to use. */
export function initialsOf(name: string): string {
  const words = name
    .normalize("NFC")
    .split(/[\s\-_.]+/u)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  const first = Array.from(words[0]!)[0]!;
  const last = words.length > 1 ? Array.from(words[words.length - 1]!)[0]! : "";
  return (first + last).toLocaleUpperCase();
}

/** How long a picture link stays valid; pictures are re-signed on every response. */
export const AVATAR_LINK_SECONDS = 300;

export interface AvatarView {
  /** A short-lived link to the picture, or `null` when the person has none (show the initials). */
  url: string | null;
  initials: string;
  updatedAt: Date | null;
}

/** Signed picture links for many memberships at once (member lists, pickers, owner chips). */
export async function avatarViewsFor(
  organizationId: string,
  people: readonly { membershipId: string; name: string }[],
): Promise<Map<string, AvatarView>> {
  const out = new Map<string, AvatarView>();
  if (people.length === 0) return out;
  const rows = await withOrgContext(organizationId, async (tx) => {
    const members = await tx.membership.findMany({
      where: { organizationId, id: { in: people.map((p) => p.membershipId) } },
      select: { id: true, avatarFileId: true, avatarUpdatedAt: true },
    });
    const fileIds = members.flatMap((m) => (m.avatarFileId ? [m.avatarFileId] : []));
    const files = fileIds.length
      ? await tx.file.findMany({
          where: { organizationId, id: { in: fileIds } },
          select: { id: true, storageKey: true, status: true, mimeType: true, name: true },
        })
      : [];
    const fileById = new Map(files.map((f) => [f.id, f]));
    return members.map((m) => ({
      id: m.id,
      avatarUpdatedAt: m.avatarUpdatedAt,
      avatarFile: m.avatarFileId ? (fileById.get(m.avatarFileId) ?? null) : null,
    }));
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const driver = getStorageDriver();
  await Promise.all(
    people.map(async (p) => {
      const row = byId.get(p.membershipId);
      const file = row?.avatarFile;
      let url: string | null = null;
      if (file && file.status === "READY") {
        const link = await driver.signDownload(file.storageKey, {
          expiresInSeconds: AVATAR_LINK_SECONDS,
          fileName: file.name,
          contentType: file.mimeType,
          disposition: "inline",
        });
        url = link.url;
      }
      out.set(p.membershipId, {
        url,
        initials: initialsOf(p.name),
        updatedAt: url ? (row?.avatarUpdatedAt ?? null) : null,
      });
    }),
  );
  return out;
}

/** Adds `avatarUrl` and `initials` to rows that carry a membership id and a display name. */
export async function withAvatars<T extends { membershipId: string }>(
  organizationId: string,
  rows: readonly T[],
  nameOf: (row: T) => string,
): Promise<(T & { avatarUrl: string | null; initials: string })[]> {
  const views = await avatarViewsFor(
    organizationId,
    rows.map((r) => ({ membershipId: r.membershipId, name: nameOf(r) })),
  );
  return rows.map((r) => {
    const v = views.get(r.membershipId)!;
    return { ...r, avatarUrl: v.url, initials: v.initials };
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const NAME_MAX = 120;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()\-.]{3,30}$/;

export function isValidTimeZone(tz: string): boolean {
  if (tz.trim() !== tz || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface MyProfile {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  /** The person's own zone; `null` means "use the organisation's". */
  timeZone: string | null;
  organizationTimeZone: string;
  /** The zone times are shown in: the person's own, else the organisation's. */
  effectiveTimeZone: string;
  avatar: AvatarView & { crop: AvatarCrop | null };
}

export interface AvatarCrop {
  x: number;
  y: number;
  size: number;
}

export interface UpdateMyProfileInput {
  name?: string;
  phone?: string | null;
  timeZone?: string | null;
}

const PROFILE_AUDITED = ["name", "phone", "timeZone"] as const;

function parseCrop(value: Prisma.JsonValue | null): AvatarCrop | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.x === "number" && typeof v.y === "number" && typeof v.size === "number") {
    return { x: v.x, y: v.y, size: v.size };
  }
  return null;
}

export async function getMyProfile(ctx: AuthContext): Promise<MyProfile> {
  const [user, org, membership] = await Promise.all([
    adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
    adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { timezone: true },
    }),
    withOrgContext(ctx.organizationId, (tx) =>
      tx.membership.findFirstOrThrow({
        where: { id: ctx.membershipId, organizationId: ctx.organizationId },
        select: { avatarCrop: true },
      }),
    ),
  ]);
  const views = await avatarViewsFor(ctx.organizationId, [{ membershipId: ctx.membershipId, name: user.name }]);
  const avatar = views.get(ctx.membershipId)!;
  return {
    membershipId: ctx.membershipId,
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    timeZone: user.timeZone,
    organizationTimeZone: org.timezone,
    effectiveTimeZone: user.timeZone ?? org.timezone,
    avatar: { ...avatar, crop: avatar.url ? parseCrop(membership.avatarCrop) : null },
  };
}

export function validateProfileInput(input: UpdateMyProfileInput): UpdateMyProfileInput {
  const issues: ValidationIssue[] = [];
  const clean: UpdateMyProfileInput = {};

  if (input.name !== undefined) {
    const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
    // eslint-disable-next-line no-control-regex
    if (name.length === 0) issues.push({ path: "name", message: "Your name cannot be empty." });
    else if (name.length > NAME_MAX) issues.push({ path: "name", message: `Your name must be at most ${NAME_MAX} characters.` });
    // eslint-disable-next-line no-control-regex
    else if (/[\u0000-\u001f\u007f]/.test(name)) issues.push({ path: "name", message: "Your name contains characters that are not allowed." });
    else clean.name = name;
  }
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone.trim() === "") clean.phone = null;
    else {
      const phone = input.phone.trim();
      if (!PHONE_PATTERN.test(phone)) {
        issues.push({ path: "phone", message: "Enter a phone number with digits, spaces, dashes or brackets, optionally starting with +." });
      } else clean.phone = phone;
    }
  }
  if (input.timeZone !== undefined) {
    if (input.timeZone === null) clean.timeZone = null;
    else if (!isValidTimeZone(input.timeZone)) {
      issues.push({ path: "timeZone", message: `"${input.timeZone}" is not a time zone we recognise. Use a name like Africa/Nairobi.` });
    } else clean.timeZone = input.timeZone;
  }
  if (issues.length > 0) {
    throw new ValidationError(issues.length === 1 ? issues[0]!.message : "Some profile details are not valid.", issues);
  }
  return clean;
}

export async function updateMyProfile(ctx: AuthContext, input: UpdateMyProfileInput): Promise<MyProfile> {
  const clean = validateProfileInput(input);
  const before = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const diff = diffAuditedFields(before, clean, PROFILE_AUDITED);
  if (diff) {
    await adminDb.user.update({ where: { id: ctx.userId }, data: clean });
    // A person's own details; the audit trail records that they changed and from/to, never the picture bytes.
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "profile.updated",
      entityType: "Membership",
      entityId: ctx.membershipId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }
  invalidateMeContext({ userId: ctx.userId });
  return getMyProfile(ctx);
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export const AVATAR_OUTPUT_PX = 256;
export const AVATAR_MIN_PX = 128;
export const AVATAR_MAX_PX = 8000;
/** Anything with more pixels than this is never decoded: protection against decompression bombs. */
export const AVATAR_MAX_PIXELS = 40_000_000;

function imageIssue(code: string, message: string, path = "file"): ValidationError {
  return new ValidationError(message, [{ path, message, code }]);
}

export interface SetAvatarInput {
  fileId: string;
  /** A square, in pixels of the image as it is displayed (after rotation); omitted = the centre square. */
  crop?: AvatarCrop | null;
}

interface ProcessedAvatar {
  data: Buffer;
  crop: AvatarCrop;
}

/** Decodes, checks, crops, resizes and re-encodes. Everything the uploader embedded (EXIF, GPS, profiles, trailing bytes) is dropped. */
export async function processAvatarImage(original: Buffer, requestedCrop?: AvatarCrop | null): Promise<ProcessedAvatar> {
  let width: number;
  let height: number;
  try {
    const meta = await sharp(original, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error" }).metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    // EXIF orientations 5-8 are drawn rotated by a quarter turn; the crop is in displayed pixels.
    const quarterTurn = meta.orientation !== undefined && meta.orientation >= 5;
    width = quarterTurn ? meta.height : meta.width;
    height = quarterTurn ? meta.width : meta.height;
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      throw imageIssue("IMAGE_DIMENSIONS_TOO_LARGE", `The picture is larger than ${AVATAR_MAX_PX} pixels on a side. Choose a smaller one.`);
    }
    throw imageIssue("IMAGE_CORRUPT", "That picture could not be read. Choose another file.");
  }

  if (width > AVATAR_MAX_PX || height > AVATAR_MAX_PX) {
    throw imageIssue("IMAGE_DIMENSIONS_TOO_LARGE", `The picture is larger than ${AVATAR_MAX_PX} pixels on a side. Choose a smaller one.`);
  }
  if (width < AVATAR_MIN_PX || height < AVATAR_MIN_PX) {
    throw imageIssue("IMAGE_TOO_SMALL", `The picture is too small (${width}×${height}). Use one at least ${AVATAR_MIN_PX}×${AVATAR_MIN_PX} pixels.`);
  }

  let crop: AvatarCrop;
  if (requestedCrop) {
    const { x, y, size } = requestedCrop;
    const ints = [x, y, size].every((n) => Number.isInteger(n));
    if (!ints || x < 0 || y < 0 || size < AVATAR_MIN_PX || x + size > width || y + size > height) {
      throw imageIssue(
        "CROP_INVALID",
        `The crop must be a square of at least ${AVATAR_MIN_PX} pixels that lies inside the picture (${width}×${height}).`,
        "crop",
      );
    }
    crop = { x, y, size };
  } else {
    const size = Math.min(width, height);
    crop = { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
  }

  try {
    // Orient first (into a lossless intermediate) so that the crop applies to what the person saw.
    const oriented = await sharp(original, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error" })
      .rotate()
      .png({ compressionLevel: 1 })
      .toBuffer();
    const data = await sharp(oriented)
      .extract({ left: crop.x, top: crop.y, width: crop.size, height: crop.size })
      .resize(AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer(); // sharp drops all metadata unless asked to keep it
    return { data, crop };
  } catch {
    throw imageIssue("IMAGE_CORRUPT", "That picture could not be read. Choose another file.");
  }
}

/** The bytes of the uploaded original are removed at once: they may carry location data the person did not mean to share. */
async function destroyOriginal(organizationId: string, file: { id: string; storageKey: string }) {
  await getStorageDriver().deleteObject(file.storageKey).catch(() => undefined);
  const now = new Date();
  await updateFileRecord(organizationId, file.id, { status: "DELETED", deletedAt: now, purgedAt: now });
}

export async function setMyAvatar(ctx: AuthContext, input: SetAvatarInput): Promise<MyProfile> {
  const file = await getFileById(ctx.organizationId, input.fileId);
  if (
    !file ||
    file.status === "DELETED" ||
    file.purpose !== "AVATAR" ||
    file.ownerMembershipId !== ctx.membershipId
  ) {
    throw new NotFoundError("File", input.fileId);
  }
  if (file.status !== "READY") {
    throw new ValidationError("Finish uploading the picture first.", [
      { path: "fileId", message: "Finish uploading the picture first." },
    ]);
  }

  const original = await getStorageDriver().getObject(file.storageKey, FILE_POLICIES.AVATAR.maxBytes);
  let processed: ProcessedAvatar;
  try {
    processed = await processAvatarImage(original, input.crop ?? null);
  } catch (err) {
    // A picture that cannot be used is not left lying around.
    if (err instanceof ValidationError && err.issues?.some((i) => i.code !== "CROP_INVALID")) {
      await destroyOriginal(ctx.organizationId, file);
    }
    throw err;
  }

  const stored = await storeGeneratedFile({
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    purpose: "AVATAR",
    name: "avatar.webp",
    mimeType: "image/webp",
    data: processed.data,
  });
  await destroyOriginal(ctx.organizationId, file);

  const previous = await withOrgContext(ctx.organizationId, async (tx) => {
    const current = await tx.membership.findFirstOrThrow({
      where: { id: ctx.membershipId, organizationId: ctx.organizationId },
      select: { avatarFileId: true },
    });
    await tx.membership.update({
      where: { id: ctx.membershipId, organizationId: ctx.organizationId },
      data: { avatarFileId: stored.id, avatarCrop: processed.crop as unknown as Prisma.InputJsonValue, avatarUpdatedAt: new Date() },
    });
    return current.avatarFileId;
  });
  if (previous) {
    await updateFileRecord(ctx.organizationId, previous, { status: "DELETED", deletedAt: new Date() });
  }

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "profile.avatar_set",
    entityType: "Membership",
    entityId: ctx.membershipId,
    metadata: { hadPicture: previous !== null },
  });
  invalidateMeContext({ userId: ctx.userId });
  return getMyProfile(ctx);
}

export async function removeMyAvatar(ctx: AuthContext): Promise<MyProfile> {
  const previous = await withOrgContext(ctx.organizationId, async (tx) => {
    const current = await tx.membership.findFirstOrThrow({
      where: { id: ctx.membershipId, organizationId: ctx.organizationId },
      select: { avatarFileId: true },
    });
    if (current.avatarFileId) {
      await tx.membership.update({
        where: { id: ctx.membershipId, organizationId: ctx.organizationId },
        data: { avatarFileId: null, avatarCrop: Prisma.DbNull, avatarUpdatedAt: null },
      });
    }
    return current.avatarFileId;
  });
  if (previous) {
    await updateFileRecord(ctx.organizationId, previous, { status: "DELETED", deletedAt: new Date() });
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "profile.avatar_removed",
      entityType: "Membership",
      entityId: ctx.membershipId,
    });
  }
  invalidateMeContext({ userId: ctx.userId });
  return getMyProfile(ctx);
}
