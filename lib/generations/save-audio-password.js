/**
 * Temporary gate for storing generation MP3 audio in R2.
 * Default password is intentional for now; override with env in production later.
 */
const DEFAULT_AUDIO_SAVE_PASSWORD = "123a";

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getGenerationAudioSavePassword() {
  const fromEnv = asTrimmedString(process.env.GENERATION_AUDIO_SAVE_PASSWORD);

  return fromEnv || DEFAULT_AUDIO_SAVE_PASSWORD;
}

export function isValidGenerationAudioSavePassword(value) {
  return asTrimmedString(value) === getGenerationAudioSavePassword();
}
