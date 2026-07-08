import { z } from "zod";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const TEMP_TUNNEL_HOST_PATTERNS = [
  /\.ngrok-free\.app$/i,
  /\.ngrok\.io$/i,
  /\.trycloudflare\.com$/i,
  /\.loca\.lt$/i,
];

const isPublicOrAffiliateKey = (value) =>
  value.startsWith("sup_pk_") || value.startsWith("sup_afk_");

const isSandboxSecretKey = (value) =>
  value.startsWith("sk_test_") ||
  (value.startsWith("sup_sk_") &&
    !value.startsWith("sk_live_") &&
    !value.startsWith("sup_sk_live_") &&
    !value.startsWith("sup_live_") &&
    !value.startsWith("sup_pk_") &&
    !value.startsWith("sup_afk_"));

const isLiveSecretKey = (value) =>
  value.startsWith("sk_live_") ||
  value.startsWith("sup_sk_live_") ||
  value.startsWith("sup_live_");

const isGenericServerSecretKey = (value) =>
  value.startsWith("sup_sk_") &&
  !value.startsWith("sup_sk_live_") &&
  !value.startsWith("sup_pk_") &&
  !value.startsWith("sup_afk_");

function envValue(name) {
  const value = process.env[name];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue || undefined;
}

function normalizeMode(value) {
  const normalizedMode = String(value ?? "sandbox")
    .trim()
    .toLowerCase();

  if (normalizedMode === "test") {
    return "sandbox";
  }

  return normalizedMode;
}

function normalizeBooleanString(value) {
  return String(value ?? "false").trim().toLowerCase();
}

function selectedSumUpCredentials(mode) {
  if (mode === "live") {
    return {
      apiKey: envValue("SUMUP_API_KEY_LIVE") ?? envValue("SUMUP_API_KEY"),
      apiKeySource: envValue("SUMUP_API_KEY_LIVE")
        ? "SUMUP_API_KEY_LIVE"
        : "SUMUP_API_KEY",
      merchantCode:
        envValue("SUMUP_MERCHANT_CODE_LIVE") ??
        envValue("SUMUP_MERCHANT_CODE"),
    };
  }

  return {
    apiKey: envValue("SUMUP_API_KEY_TEST") ?? envValue("SUMUP_API_KEY"),
    apiKeySource: envValue("SUMUP_API_KEY_TEST")
      ? "SUMUP_API_KEY_TEST"
      : "SUMUP_API_KEY",
    merchantCode:
      envValue("SUMUP_MERCHANT_CODE_TEST") ?? envValue("SUMUP_MERCHANT_CODE"),
  };
}

function isUnsafeTemporaryLiveUrl(value) {
  const url = new URL(value);

  return (
    url.protocol !== "https:" ||
    LOCAL_HOSTNAMES.has(url.hostname) ||
    TEMP_TUNNEL_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))
  );
}

const sumupEnvironmentSchema = z
  .object({
    ALLOW_TEMP_LIVE_PAYMENT_URLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    APP_BASE_URL: z.string().url().optional(),
    SUMUP_API_KEY: z.string().min(1),
    SUMUP_API_KEY_SOURCE: z
      .enum(["SUMUP_API_KEY", "SUMUP_API_KEY_TEST", "SUMUP_API_KEY_LIVE"])
      .default("SUMUP_API_KEY"),
    SUMUP_MERCHANT_CODE: z.string().min(1),
    SUMUP_API_BASE_URL: z.string().url().default("https://api.sumup.com"),
    SUMUP_CHECKOUT_RETURN_URL: z.string().url(),
    SUMUP_CURRENCY: z.literal("GBP").default("GBP"),
    SUMUP_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    SUMUP_WEBHOOK_URL: z.string().url(),
  })
  .superRefine((environment, context) => {
    if (isPublicOrAffiliateKey(environment.SUMUP_API_KEY)) {
      context.addIssue({
        code: "custom",
        message:
          "SUMUP_API_KEY must be a server secret key, not a public or affiliate key.",
        path: ["SUMUP_API_KEY"],
      });
      return;
    }

    if (
      environment.SUMUP_MODE === "sandbox" &&
      !isSandboxSecretKey(environment.SUMUP_API_KEY)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SUMUP_API_KEY must be a SumUp sandbox/server secret key when SUMUP_MODE=sandbox.",
        path: ["SUMUP_API_KEY"],
      });
    }

    if (
      environment.SUMUP_MODE === "live" &&
      !isLiveSecretKey(environment.SUMUP_API_KEY) &&
      !(
        environment.SUMUP_API_KEY_SOURCE === "SUMUP_API_KEY_LIVE" &&
        isGenericServerSecretKey(environment.SUMUP_API_KEY)
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SUMUP_API_KEY must be a SumUp live server secret key when SUMUP_MODE=live.",
        path: ["SUMUP_API_KEY"],
      });
    }

    if (
      environment.SUMUP_MODE === "live" &&
      !environment.ALLOW_TEMP_LIVE_PAYMENT_URLS
    ) {
      for (const key of [
        "APP_BASE_URL",
        "SUMUP_CHECKOUT_RETURN_URL",
        "SUMUP_WEBHOOK_URL",
      ]) {
        const value = environment[key];

        if (!value || isUnsafeTemporaryLiveUrl(value)) {
          context.addIssue({
            code: "custom",
            message:
              `${key} must be a stable production HTTPS URL when SUMUP_MODE=live.`,
            path: [key],
          });
        }
      }
    }
  });

let cachedEnvironment = null;

export function getSumUpEnvironment() {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  const sumupMode = normalizeMode(envValue("SUMUP_MODE"));
  const credentials = selectedSumUpCredentials(sumupMode);

  cachedEnvironment = sumupEnvironmentSchema.parse({
    ALLOW_TEMP_LIVE_PAYMENT_URLS:
      normalizeBooleanString(envValue("ALLOW_TEMP_LIVE_PAYMENT_URLS")),
    APP_BASE_URL: envValue("APP_BASE_URL"),
    SUMUP_API_KEY: credentials.apiKey,
    SUMUP_API_KEY_SOURCE: credentials.apiKeySource,
    SUMUP_MERCHANT_CODE: credentials.merchantCode,
    SUMUP_API_BASE_URL:
      envValue("SUMUP_API_BASE_URL") || "https://api.sumup.com",
    SUMUP_CURRENCY: envValue("SUMUP_CURRENCY") || "GBP",
    SUMUP_MODE: sumupMode,
    SUMUP_WEBHOOK_URL: envValue("SUMUP_WEBHOOK_URL"),
    SUMUP_CHECKOUT_RETURN_URL: envValue("SUMUP_CHECKOUT_RETURN_URL"),
  });

  return cachedEnvironment;
}

export function resetSumUpEnvironmentForTests() {
  cachedEnvironment = null;
}
