import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const REMOTE_PREFIX = "remote:";
const SUPPORTED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function storageError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function stripRemotePrefix(value) {
  const key = String(value || "");
  return key.startsWith(REMOTE_PREFIX) ? key.slice(REMOTE_PREFIX.length) : "";
}

function teamPrefix(teamCode) {
  return `teams/${String(teamCode || "").toUpperCase()}/`;
}

export function createScreenshotStorage({ env = process.env, client } = {}) {
  const bucket = String(env.SCREENSHOT_BUCKET || "prematch-screenshots");
  const configured = Boolean(
    client
    || (env.AWS_ACCESS_KEY_ID
      && env.AWS_SECRET_ACCESS_KEY
      && env.AWS_ENDPOINT_URL_S3
      && env.AWS_REGION),
  );
  const s3 = client || (configured ? new S3Client({
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  }) : null);

  function requireStorage() {
    if (!s3) {
      throw storageError("Screenshot storage is not configured.", "STORAGE_UNAVAILABLE", 503);
    }
  }

  function requireOwnedKey(screenshotKey, teamCode) {
    const objectKey = stripRemotePrefix(screenshotKey);
    if (!objectKey || !objectKey.startsWith(teamPrefix(teamCode)) || objectKey.includes("..")) {
      throw storageError("Screenshot access is not allowed.", "SCREENSHOT_FORBIDDEN", 403);
    }
    return objectKey;
  }

  function requireReadableKey(screenshotKey, profile) {
    const objectKey = requireOwnedKey(screenshotKey, profile.teamCode);
    if (profile.role === "player" && !objectKey.startsWith(`${teamPrefix(profile.teamCode)}players/${profile.id}/`)) {
      throw storageError("Screenshot access is not allowed.", "SCREENSHOT_FORBIDDEN", 403);
    }
    return objectKey;
  }

  function isOwnedKey(screenshotKey, teamCode) {
    try {
      requireOwnedKey(screenshotKey, teamCode);
      return true;
    } catch {
      return false;
    }
  }

  return {
    configured,
    bucket,
    isOwnedKey,
    async upload({ profile, body, contentType, capturedFor }) {
      requireStorage();
      const extension = SUPPORTED_IMAGE_TYPES.get(contentType);
      if (!extension) {
        throw storageError("Only JPEG, PNG, WebP, or GIF screenshots are supported.", "INVALID_SCREENSHOT_TYPE", 415);
      }
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw storageError("A screenshot file is required.", "SCREENSHOT_REQUIRED", 400);
      }

      const objectKey = `${teamPrefix(profile.teamCode)}players/${profile.id}/${Date.now()}-${randomUUID()}.${extension}`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
        CacheControl: "private, max-age=300",
        Metadata: {
          player: String(profile.id),
          slot: String(capturedFor || "proof").replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
        },
      }));
      return `${REMOTE_PREFIX}${objectKey}`;
    },
    async download({ profile, screenshotKey }) {
      requireStorage();
      const objectKey = requireReadableKey(screenshotKey, profile);
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) throw storageError("Screenshot data is unavailable.", "SCREENSHOT_NOT_FOUND", 404);
      return {
        body: Buffer.from(bytes),
        contentType: object.ContentType || "application/octet-stream",
      };
    },
    async deleteOne({ profile, screenshotKey }) {
      requireStorage();
      const objectKey = requireReadableKey(screenshotKey, profile);
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: [{ Key: objectKey }], Quiet: true },
      }));
      return true;
    },
    async deleteMany(teamCode, screenshotKeys = []) {
      requireStorage();
      const objects = [...new Set(screenshotKeys)]
        .filter((key) => isOwnedKey(key, teamCode))
        .map((key) => ({ Key: stripRemotePrefix(key) }));
      if (!objects.length) return 0;
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true },
      }));
      return objects.length;
    },
  };
}
