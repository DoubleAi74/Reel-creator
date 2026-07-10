import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  R2ConfigError,
  getR2Environment,
  getR2PublicBaseUrl,
  isR2Enabled,
  resetR2EnvironmentForTests,
} from "./r2-env.js";
import {
  R2OperationError,
  deleteR2Object,
  getR2Client,
  getR2Object,
  headR2Object,
  isR2NotFoundError,
  putR2Object,
  resetR2ClientForTests,
  toSafeR2ErrorCode,
} from "./r2-client.js";

const enabledEnvironment = {
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_ACCOUNT_ID: "test-account-id",
  R2_BUCKET_NAME: "test-bucket",
  R2_ENABLED: "true",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
};

function stubEnabledEnvironment(overrides = {}) {
  resetR2EnvironmentForTests();
  resetR2ClientForTests();

  for (const [key, value] of Object.entries({
    ...enabledEnvironment,
    ...overrides,
  })) {
    vi.stubEnv(key, value);
  }
}

function stubSend(implementation) {
  return vi
    .spyOn(S3Client.prototype, "send")
    .mockImplementation(implementation);
}

afterEach(() => {
  resetR2EnvironmentForTests();
  resetR2ClientForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("R2 environment", () => {
  it("stays disabled until explicitly enabled", () => {
    vi.stubEnv("R2_ENABLED", "false");

    expect(isR2Enabled()).toBe(false);
    expect(getR2Environment()).toEqual({ enabled: false });
    expect(getR2PublicBaseUrl()).toBeNull();
  });

  it("requires all R2 credentials when enabled", () => {
    stubEnabledEnvironment({ R2_BUCKET_NAME: "" });

    expect(() => getR2Environment()).toThrow(R2ConfigError);
  });

  it("builds the Cloudflare R2 endpoint and public base URL", () => {
    stubEnabledEnvironment({
      R2_PUBLIC_BASE_URL: "https://cdn.example.test/audio",
    });

    expect(getR2Environment()).toMatchObject({
      bucketName: "test-bucket",
      enabled: true,
      endpoint: "https://test-account-id.r2.cloudflarestorage.com",
      publicBaseUrl: "https://cdn.example.test/audio",
    });
    expect(getR2PublicBaseUrl()).toBe("https://cdn.example.test/audio");
  });
});

describe("R2 client wrappers", () => {
  it("throws a disabled operation error when R2 is off", () => {
    vi.stubEnv("R2_ENABLED", "false");

    expect(() => getR2Client()).toThrow(R2OperationError);
  });

  it("puts an object with bucket, key, content type, length, and metadata", async () => {
    stubEnabledEnvironment();
    const sendSpy = stubSend(async () => ({}));

    const result = await putR2Object({
      body: "mp3",
      contentLength: 3,
      contentType: "audio/mpeg",
      key: "generations/abc/audio.mp3",
      metadata: { generationid: "abc" },
    });

    expect(result).toEqual({ key: "generations/abc/audio.mp3", ok: true });
    expect(sendSpy.mock.calls[0][0].input).toEqual({
      Body: "mp3",
      Bucket: "test-bucket",
      ContentLength: 3,
      ContentType: "audio/mpeg",
      Key: "generations/abc/audio.mp3",
      Metadata: { generationid: "abc" },
    });
  });

  it("deletes and heads objects with missing-object tolerance", async () => {
    stubEnabledEnvironment();
    const notFoundError = Object.assign(new Error("not found"), {
      $metadata: { httpStatusCode: 404 },
      name: "NoSuchKey",
    });
    stubSend(async () => {
      throw notFoundError;
    });

    await expect(deleteR2Object({ key: "missing.mp3" })).resolves.toEqual({
      alreadyMissing: true,
      key: "missing.mp3",
      ok: true,
    });
    await expect(headR2Object({ key: "missing.mp3" })).resolves.toEqual({
      exists: false,
      key: "missing.mp3",
    });
  });

  it("gets object bodies for the media proxy", async () => {
    stubEnabledEnvironment();
    stubSend(async () => ({
      Body: "body",
      ContentLength: 4,
      ContentType: "audio/mpeg",
    }));

    await expect(getR2Object({ key: "generations/abc/audio.mp3" })).resolves.toEqual({
      body: "body",
      contentLength: 4,
      contentType: "audio/mpeg",
      key: "generations/abc/audio.mp3",
    });
  });

  it("maps known failures to safe error codes", () => {
    expect(toSafeR2ErrorCode(null)).toBe("R2_UNKNOWN");
    expect(toSafeR2ErrorCode(new R2ConfigError("missing"))).toBe(
      "R2_CONFIG_MISSING",
    );
    expect(toSafeR2ErrorCode(new R2OperationError("off", "R2_DISABLED"))).toBe(
      "R2_DISABLED",
    );
    expect(
      toSafeR2ErrorCode(
        Object.assign(new Error("x"), { $metadata: { httpStatusCode: 404 } }),
      ),
    ).toBe("R2_OBJECT_NOT_FOUND");
    expect(
      toSafeR2ErrorCode(Object.assign(new Error("x"), { name: "AccessDenied" })),
    ).toBe("R2_ACCESS_DENIED");
    expect(
      toSafeR2ErrorCode(Object.assign(new Error("x"), { code: "ETIMEDOUT" })),
    ).toBe("R2_TIMEOUT");
    expect(isR2NotFoundError(Object.assign(new Error("x"), { name: "NoSuchKey" }))).toBe(
      true,
    );
  });
});
