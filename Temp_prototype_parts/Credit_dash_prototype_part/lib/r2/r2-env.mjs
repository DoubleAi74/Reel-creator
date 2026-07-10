import { z } from "zod";

export const REQUIRED_R2_ENV_NAMES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];

export class R2ConfigError extends Error {
  constructor(message, missingNames = []) {
    super(message);
    this.name = "R2ConfigError";
    this.code = "R2_CONFIG_MISSING";
    this.missingNames = missingNames;
  }
}

function envValue(name) {
  const value = process.env[name];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue || undefined;
}

function normalizeBooleanString(value) {
  return String(value ?? "false").trim().toLowerCase();
}

const r2EnvironmentSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
});

let cachedEnvironment = null;

export function isR2Enabled() {
  return normalizeBooleanString(envValue("R2_ENABLED")) === "true";
}

export function getR2Environment() {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  if (!isR2Enabled()) {
    cachedEnvironment = { enabled: false };
    return cachedEnvironment;
  }

  const missingNames = REQUIRED_R2_ENV_NAMES.filter((name) => !envValue(name));

  if (missingNames.length > 0) {
    throw new R2ConfigError(
      `R2_ENABLED=true but required R2 environment variables are missing: ${missingNames.join(", ")}.`,
      missingNames,
    );
  }

  const parsedEnvironment = r2EnvironmentSchema.parse({
    R2_ACCOUNT_ID: envValue("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID: envValue("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: envValue("R2_SECRET_ACCESS_KEY"),
    R2_BUCKET_NAME: envValue("R2_BUCKET_NAME"),
    R2_PUBLIC_BASE_URL: envValue("R2_PUBLIC_BASE_URL"),
  });

  cachedEnvironment = {
    enabled: true,
    accountId: parsedEnvironment.R2_ACCOUNT_ID,
    accessKeyId: parsedEnvironment.R2_ACCESS_KEY_ID,
    secretAccessKey: parsedEnvironment.R2_SECRET_ACCESS_KEY,
    bucketName: parsedEnvironment.R2_BUCKET_NAME,
    publicBaseUrl: parsedEnvironment.R2_PUBLIC_BASE_URL ?? null,
    endpoint: `https://${parsedEnvironment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };

  return cachedEnvironment;
}

export function resetR2EnvironmentForTests() {
  cachedEnvironment = null;
}
