import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function unquote(value) {
  const trimmedValue = value.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

export function loadEnvLocal({ cwd = process.cwd(), override = false } = {}) {
  const envPath = resolve(cwd, ".env.local");

  if (!existsSync(envPath)) {
    return [];
  }

  const loadedKeys = [];
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trim()
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    const rawValue = normalizedLine.slice(separatorIndex + 1);

    if (!key || (!override && process.env[key] != null)) {
      continue;
    }

    process.env[key] = unquote(rawValue);
    loadedKeys.push(key);
  }

  return loadedKeys;
}
