import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { probeAudio } from "../lib/audio-ffmpeg.js";
import { sanitizeError } from "../lib/diagnostics.js";
import { YOUTUBE_AUDIO_PROVIDER_OPTIONS } from "../lib/provider-options.js";
import { getYoutubeAudioConfig } from "../lib/server-config.js";
import { runProviderSegmentJob } from "../lib/youtube-audio-provider-runner.js";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const cliArgs = process.argv.slice(2);
const inputUrl = cliArgs.find((arg) => !arg.startsWith("--"));
const providerArg = cliArgs
  .find((arg) => arg.startsWith("--provider="))
  ?.split("=")[1];
const startTime = Number(process.env.YT_MP3_TEST_START || 0);
const endTime = Number(process.env.YT_MP3_TEST_END || 5);

function line(message = "") {
  console.log(message);
}

if (!inputUrl) {
  line("YouTube audio provider check");
  line("----------------------------");
  line("Run it like this:");
  line('  npm run providers:check -- "https://www.youtube.com/watch?v=VIDEO_ID"');
  line("");
  line("Optional:");
  line("  YT_MP3_TEST_START=30 YT_MP3_TEST_END=45 npm run providers:check -- URL");
  line("  npm run providers:check -- URL --provider=youtube-mp36");
  line("  YT_AUDIO_DEBUG=1 npm run providers:check -- URL");
  process.exit(1);
}

const selectedProviders = providerArg
  ? YOUTUBE_AUDIO_PROVIDER_OPTIONS.filter((provider) => provider.id === providerArg)
  : YOUTUBE_AUDIO_PROVIDER_OPTIONS;

if (selectedProviders.length === 0) {
  throw new Error(`Unknown provider: ${providerArg}`);
}

const config = getYoutubeAudioConfig();

line("YouTube audio provider check");
line("----------------------------");
line("Key: present");
line(`Test segment: ${startTime}s to ${endTime}s`);
line("Signed URLs and secrets will not be printed.");
line("");

for (const provider of selectedProviders) {
  await checkProvider(provider);
}

async function checkProvider(provider) {
  const job = {
    id: randomUUID(),
    sourceUrl: inputUrl,
    startTime,
    endTime,
    providerId: provider.id,
    providerName: provider.name,
  };

  line(`Provider: ${provider.name} (${provider.id})`);

  try {
    const { providerResult, storedAsset, attempt } = await runProviderSegmentJob(
      {
        url: inputUrl,
        startTime,
        endTime,
        providerId: provider.id,
      },
      job,
      {
        config,
        onAttempt: (attemptInfo) => {
          if (attemptInfo.preferredFormat) {
            line(`  Trying format: ${attemptInfo.preferredFormat}`);
          }
        },
        onPhase: (phase) => line(`  Phase: ${phase}`),
      },
    );

    const fileStat = await stat(storedAsset.storedAssetPath);
    const probe = await probeAudio(storedAsset.storedAssetPath);

    line(`  Provider request: OK`);
    line(`  Trim mode: ${providerResult.trimMode}`);
    line(
      `  Media format used: ${
        attempt.preferredFormat || providerResult.mediaFormat || "provider"
      }`,
    );
    printQuotaHeaders("Provider quota", providerResult.quotaHeaders);
    line(`  Media fetch: OK`);
    line(`  Content-Type: ${storedAsset.mediaResult?.contentType || "unknown"}`);
    line(`  Content-Length: ${storedAsset.mediaResult?.contentLength || "unknown"}`);
    line(`  Source host: ${storedAsset.mediaResult?.sourceHost || "unknown"}`);
    printQuotaHeaders("Media quota", storedAsset.mediaResult?.quotaHeaders);
    line(`  Output: ${storedAsset.storedAssetPath}`);
    line(`  Output bytes: ${fileStat.size}`);
    line(`  Output duration: ${probe.duration?.toFixed(2) || "unknown"}s`);
    line(`  Result: success`);
  } catch (error) {
    line(`  Result: failed`);
    line(`  Error code: ${error.errorCode || "INTERNAL_ERROR"}`);
    line(`  Message: ${safeMessage(error.message)}`);
    line(`  Diagnostics: ${JSON.stringify(sanitizeError(error))}`);
  }

  line("");
}

function printQuotaHeaders(label, headers) {
  if (!headers || Object.keys(headers).length === 0) {
    return;
  }

  line(`  ${label}: ${JSON.stringify(headers)}`);
}

function safeMessage(message) {
  return String(message || "").replace(/https?:\/\/\S+/gi, "REDACTED_URL");
}
