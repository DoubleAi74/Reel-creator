import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { R2ConfigError, resetR2EnvironmentForTests } from "./r2-env.mjs";
import {
  R2OperationError,
  deleteR2Object,
  getR2Client,
  headR2Object,
  isR2NotFoundError,
  putR2Object,
  resetR2ClientForTests,
  toSafeR2ErrorCode,
} from "./r2-client.mjs";

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

describe("R2 client factory", () => {
  it("throws a disabled operation error when R2 is off", () => {
    stubEnabledEnvironment({ R2_ENABLED: "false" });

    let caughtError = null;

    try {
      getR2Client();
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(R2OperationError);
    expect(caughtError.code).toBe("R2_DISABLED");
  });

  it("builds and caches one client when enabled", () => {
    stubEnabledEnvironment();

    const client = getR2Client();

    expect(client).toBeInstanceOf(S3Client);
    expect(getR2Client()).toBe(client);
  });

  it("propagates config errors when enabled but incomplete", () => {
    stubEnabledEnvironment({ R2_BUCKET_NAME: "" });

    expect(() => getR2Client()).toThrow(R2ConfigError);
  });
});

describe("R2 object wrappers", () => {
  it("puts an object with bucket, key, content type, and metadata", async () => {
    stubEnabledEnvironment();
    const sendSpy = stubSend(async () => ({}));

    const result = await putR2Object({
      body: "<p>hi</p>",
      contentType: "text/html; charset=utf-8",
      key: "cards/abc/placeholder.json",
      metadata: { cardid: "abc" },
    });

    expect(result).toEqual({ key: "cards/abc/placeholder.json", ok: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const commandInput = sendSpy.mock.calls[0][0].input;
    expect(commandInput).toEqual({
      Body: "<p>hi</p>",
      Bucket: "test-bucket",
      ContentType: "text/html; charset=utf-8",
      Key: "cards/abc/placeholder.json",
      Metadata: { cardid: "abc" },
    });
  });

  it("deletes an object and reports success", async () => {
    stubEnabledEnvironment();
    const sendSpy = stubSend(async () => ({}));

    const result = await deleteR2Object({ key: "cards/abc/placeholder.json" });

    expect(result).toEqual({
      alreadyMissing: false,
      key: "cards/abc/placeholder.json",
      ok: true,
    });
    expect(sendSpy.mock.calls[0][0].input).toEqual({
      Bucket: "test-bucket",
      Key: "cards/abc/placeholder.json",
    });
  });

  it("treats a missing object as delete success", async () => {
    stubEnabledEnvironment();
    const notFoundError = Object.assign(new Error("no such key"), {
      $metadata: { httpStatusCode: 404 },
      name: "NoSuchKey",
    });
    stubSend(async () => {
      throw notFoundError;
    });

    const result = await deleteR2Object({ key: "cards/abc/placeholder.json" });

    expect(result).toEqual({
      alreadyMissing: true,
      key: "cards/abc/placeholder.json",
      ok: true,
    });
  });

  it("reports head object existence without throwing on 404", async () => {
    stubEnabledEnvironment();
    const notFoundError = Object.assign(new Error("not found"), {
      $metadata: { httpStatusCode: 404 },
      name: "NotFound",
    });
    stubSend(async () => {
      throw notFoundError;
    });

    const result = await headR2Object({ key: "cards/abc/placeholder.json" });

    expect(result).toEqual({ exists: false, key: "cards/abc/placeholder.json" });
  });

  it("rethrows non-404 delete failures", async () => {
    stubEnabledEnvironment();
    const accessError = Object.assign(new Error("denied"), {
      $metadata: { httpStatusCode: 403 },
      name: "AccessDenied",
    });
    stubSend(async () => {
      throw accessError;
    });

    await expect(
      deleteR2Object({ key: "cards/abc/placeholder.json" }),
    ).rejects.toThrow("denied");
  });
});

describe("safe R2 error mapping", () => {
  it("maps known failures to safe codes without leaking details", () => {
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
      toSafeR2ErrorCode(
        Object.assign(new Error("x"), { name: "SignatureDoesNotMatch" }),
      ),
    ).toBe("R2_ACCESS_DENIED");
    expect(
      toSafeR2ErrorCode(Object.assign(new Error("x"), { name: "NoSuchBucket" })),
    ).toBe("R2_BUCKET_NOT_FOUND");
    expect(
      toSafeR2ErrorCode(Object.assign(new Error("x"), { code: "ETIMEDOUT" })),
    ).toBe("R2_TIMEOUT");
    expect(toSafeR2ErrorCode(new Error("mystery"))).toBe("R2_UNKNOWN");
  });

  it("identifies not-found errors", () => {
    expect(
      isR2NotFoundError(Object.assign(new Error("x"), { name: "NoSuchKey" })),
    ).toBe(true);
    expect(isR2NotFoundError(new Error("other"))).toBe(false);
  });
});
