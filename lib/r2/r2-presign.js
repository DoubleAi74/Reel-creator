import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getR2Client, R2OperationError } from "./r2-client.js";
import { getR2Environment } from "./r2-env.js";

const DEFAULT_PUT_EXPIRES_SECONDS = 15 * 60;
const DEFAULT_GET_EXPIRES_SECONDS = 2 * 60 * 60;

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

/**
 * Presigned PUT for browser direct upload to R2.
 */
export async function createPresignedPutUrl({
  contentType,
  expiresInSeconds = DEFAULT_PUT_EXPIRES_SECONDS,
  key,
}) {
  const environment = requireEnabledR2Environment();
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: environment.bucketName,
    ContentType: contentType,
    Key: key,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: Math.max(60, Math.min(expiresInSeconds, 60 * 60)),
  });

  return {
    expiresInSeconds: Math.max(60, Math.min(expiresInSeconds, 60 * 60)),
    headers: {
      "Content-Type": contentType,
    },
    key,
    uploadUrl,
  };
}

/**
 * Presigned GET for Remotion / short-lived playback without session cookie.
 */
export async function createPresignedGetUrl({
  expiresInSeconds = DEFAULT_GET_EXPIRES_SECONDS,
  key,
}) {
  const environment = requireEnabledR2Environment();
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: environment.bucketName,
    Key: key,
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: Math.max(60, Math.min(expiresInSeconds, 6 * 60 * 60)),
  });

  return {
    expiresInSeconds: Math.max(60, Math.min(expiresInSeconds, 6 * 60 * 60)),
    key,
    url,
  };
}
