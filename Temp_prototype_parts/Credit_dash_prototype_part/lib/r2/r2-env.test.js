import { afterEach, describe, expect, it, vi } from "vitest";

import {
  R2ConfigError,
  REQUIRED_R2_ENV_NAMES,
  getR2Environment,
  isR2Enabled,
  resetR2EnvironmentForTests,
} from "./r2-env.mjs";

const enabledEnvironment = {
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_ACCOUNT_ID: "test-account-id",
  R2_BUCKET_NAME: "test-bucket",
  R2_ENABLED: "true",
  R2_PUBLIC_BASE_URL: "",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
};

function stubEnvironment(overrides = {}) {
  resetR2EnvironmentForTests();

  for (const [key, value] of Object.entries({
    ...enabledEnvironment,
    ...overrides,
  })) {
    vi.stubEnv(key, value);
  }
}

describe("R2 environment validation", () => {
  afterEach(() => {
    resetR2EnvironmentForTests();
    vi.unstubAllEnvs();
  });

  it("treats unset or false R2_ENABLED as disabled", () => {
    stubEnvironment({ R2_ENABLED: "" });
    expect(isR2Enabled()).toBe(false);
    expect(getR2Environment()).toEqual({ enabled: false });

    stubEnvironment({ R2_ENABLED: "false" });
    expect(isR2Enabled()).toBe(false);
    expect(getR2Environment()).toEqual({ enabled: false });
  });

  it("treats R2_ENABLED as case-insensitive", () => {
    stubEnvironment({ R2_ENABLED: " TRUE " });
    expect(isR2Enabled()).toBe(true);
    expect(getR2Environment().enabled).toBe(true);
  });

  it("returns full config and endpoint when enabled with all required vars", () => {
    stubEnvironment();

    expect(getR2Environment()).toEqual({
      accessKeyId: "test-access-key-id",
      accountId: "test-account-id",
      bucketName: "test-bucket",
      enabled: true,
      endpoint: "https://test-account-id.r2.cloudflarestorage.com",
      publicBaseUrl: null,
      secretAccessKey: "test-secret-access-key",
    });
  });

  it.each(REQUIRED_R2_ENV_NAMES)(
    "throws a config error naming %s when it is missing",
    (missingName) => {
      stubEnvironment({ [missingName]: "" });

      let caughtError = null;

      try {
        getR2Environment();
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(R2ConfigError);
      expect(caughtError.code).toBe("R2_CONFIG_MISSING");
      expect(caughtError.missingNames).toEqual([missingName]);
      expect(caughtError.message).toContain(missingName);
      expect(caughtError.message).not.toContain("test-secret-access-key");
    },
  );

  it("does not cache a failed enabled config", () => {
    stubEnvironment({ R2_BUCKET_NAME: "" });
    expect(() => getR2Environment()).toThrow(R2ConfigError);

    vi.stubEnv("R2_BUCKET_NAME", "recovered-bucket");
    expect(getR2Environment().bucketName).toBe("recovered-bucket");
  });

  it("accepts an optional public base URL", () => {
    stubEnvironment({ R2_PUBLIC_BASE_URL: "https://cdn.example.com" });
    expect(getR2Environment().publicBaseUrl).toBe("https://cdn.example.com");
  });

  it("rejects an invalid public base URL", () => {
    stubEnvironment({ R2_PUBLIC_BASE_URL: "not-a-url" });
    expect(() => getR2Environment()).toThrow();
  });
});
