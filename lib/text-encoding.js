// Defensive repair for "mojibake": text that was correct UTF-8 but got decoded
// once as Latin-1 (or Windows-1252) and re-saved, so e.g. "आज" becomes the
// classic two-character garble. This happens OUTSIDE this app (a file edited or
// round-tripped through a tool with the wrong charset) — the app's own export
// (Blob, UTF-8) and import (File.text(), UTF-8) are clean. But an imported
// project that is already corrupted should be healed rather than displayed
// garbled, so we run this on import. The repair is conservative: it only acts on
// strings that are entirely in the Latin-1 range AND decode cleanly as UTF-8, so
// already-correct Unicode and genuine Latin-1 text are left untouched.

// Matches a code point in the 0x80-0xFF range (the high bytes a misdecoded
// UTF-8 sequence leaves behind).
const HIGH_BYTE = /[-ÿ]/;

// Repair a single string. Returns the original when it is not mojibake.
export function repairMojibake(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  // Mojibake from UTF-8-as-Latin-1 only ever contains code points <= 0xFF. If
  // any character is above that, the string already holds real Unicode (e.g.
  // proper Devanagari) — never touch it.
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0xff) {
      return value;
    }
  }

  // Pure ASCII (ids, hex colors, plain English) has nothing to repair.
  if (!HIGH_BYTE.test(value)) {
    return value;
  }

  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i);
  }

  try {
    // `fatal` makes the decode throw on any byte sequence that is not valid
    // UTF-8 — that is the guard that keeps genuine Latin-1 text (e.g. "café")
    // from being mangled, since its bytes are not a valid UTF-8 sequence.
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded === value ? value : decoded;
  } catch {
    return value;
  }
}

// Recursively repair every string in a JSON-like value (objects, arrays,
// strings). Non-string leaves pass through untouched. Returns a repaired copy.
export function repairMojibakeDeep(value) {
  if (typeof value === "string") {
    return repairMojibake(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairMojibakeDeep(item));
  }

  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = repairMojibakeDeep(item);
    }
    return result;
  }

  return value;
}
