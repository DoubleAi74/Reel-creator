import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { R2ConfigError, getR2Environment } from "./r2-env.mjs";

export class R2OperationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "R2OperationError";
    this.code = code;
  }
}

const NOT_FOUND_ERROR_NAMES = new Set(["NoSuchKey", "NotFound", "404"]);
const ACCESS_ERROR_NAMES = new Set([
  "AccessDenied",
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "Unauthorized",
]);
const TIMEOUT_ERROR_NAMES = new Set([
  "TimeoutError",
  "RequestTimeout",
  "AbortError",
]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

export function toSafeR2ErrorCode(error) {
  if (!error) {
    return "R2_UNKNOWN";
  }

  if (error instanceof R2ConfigError) {
    return "R2_CONFIG_MISSING";
  }

  if (error instanceof R2OperationError) {
    return error.code;
  }

  const statusCode = error.$metadata?.httpStatusCode;

  if (NOT_FOUND_ERROR_NAMES.has(error.name) || statusCode === 404) {
    return "R2_OBJECT_NOT_FOUND";
  }

  if (ACCESS_ERROR_NAMES.has(error.name) || statusCode === 403 || statusCode === 401) {
    return "R2_ACCESS_DENIED";
  }

  if (error.name === "NoSuchBucket") {
    return "R2_BUCKET_NOT_FOUND";
  }

  if (
    TIMEOUT_ERROR_NAMES.has(error.name) ||
    NETWORK_ERROR_CODES.has(error.code)
  ) {
    return "R2_TIMEOUT";
  }

  return "R2_UNKNOWN";
}

export function isR2NotFoundError(error) {
  return toSafeR2ErrorCode(error) === "R2_OBJECT_NOT_FOUND";
}

function requireEnabledR2Environment() {
  const environment = getR2Environment();

  if (!environment.enabled) {
    throw new R2OperationError(
      "R2 is disabled. Set R2_ENABLED=true with valid credentials.",
      "R2_DISABLED",
    );
  }

  return environment;
}

let cachedClient = null;

export function getR2Client() {
  if (cachedClient) {
    return cachedClient;
  }

  const environment = requireEnabledR2Environment();

  cachedClient = new S3Client({
    credentials: {
      accessKeyId: environment.accessKeyId,
      secretAccessKey: environment.secretAccessKey,
    },
    endpoint: environment.endpoint,
    region: "auto",
  });

  return cachedClient;
}

export function resetR2ClientForTests() {
  cachedClient = null;
}

export async function putR2Object({ key, body, contentType, metadata }) {
  const environment = requireEnabledR2Environment();
  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Body: body,
      Bucket: environment.bucketName,
      ContentType: contentType,
      Key: key,
      Metadata: metadata,
    }),
  );

  return { key, ok: true };
}

export async function deleteR2Object({ key }) {
  const environment = requireEnabledR2Environment();
  const client = getR2Client();

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: environment.bucketName,
        Key: key,
      }),
    );
  } catch (error) {
    if (isR2NotFoundError(error)) {
      return { alreadyMissing: true, key, ok: true };
    }

    throw error;
  }

  return { alreadyMissing: false, key, ok: true };
}

export async function headR2Object({ key }) {
  const environment = requireEnabledR2Environment();
  const client = getR2Client();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: environment.bucketName,
        Key: key,
      }),
    );
  } catch (error) {
    if (isR2NotFoundError(error)) {
      return { exists: false, key };
    }

    throw error;
  }

  return { exists: true, key };
}
