import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const host =
  process.env.RAPIDAPI_YOUTUBE_MP3_HOST || "youtube-to-mp315.p.rapidapi.com";
const key = process.env.RAPIDAPI_YOUTUBE_MP3_KEY;
const inputUrl = process.argv[2] || process.env.YT_MP3_TEST_URL;
const startTime = Number(process.env.YT_MP3_TEST_START || 0);
const endTime = Number(process.env.YT_MP3_TEST_END || 5);

function line(message = "") {
  console.log(message);
}

function explainHttpStatus(status, body) {
  if (status === 401 || status === 403) {
    return [
      "Subscription/key problem.",
      "In RapidAPI, confirm you subscribed to the API and copied the key from the same app selected in the Playground.",
    ];
  }

  if (status === 429) {
    return [
      "Rate limited or quota exhausted.",
      "In RapidAPI, open the API dashboard or Pricing/Usage page and check whether the plan has calls left.",
    ];
  }

  if (status === 400) {
    return [
      "The provider rejected the request format.",
      body?.detail ? `Provider detail: ${body.detail}` : "No provider detail was returned.",
    ];
  }

  if (status >= 500) {
    return [
      "The provider had a server-side failure.",
      "Try again later or try a different authorized YouTube URL.",
    ];
  }

  return [
    `Unexpected provider HTTP status ${status}.`,
    body?.detail ? `Provider detail: ${body.detail}` : "No provider detail was returned.",
  ];
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { unparsedBody: text.slice(0, 200) };
  }
}

function providerDownloadUrl(testUrl) {
  const url = new URL(`https://${host}/download`);
  url.searchParams.set("url", testUrl);
  url.searchParams.set("format", "mp3");
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  return url;
}

function headers() {
  return {
    "X-RapidAPI-Key": key,
    "X-RapidAPI-Host": host,
  };
}

line("YouTube MP3 RapidAPI account check");
line("------------------------------------");

if (!key || !key.trim()) {
  line("Result: Missing key.");
  line("Fix: put RAPIDAPI_YOUTUBE_MP3_KEY in .env.local.");
  process.exit(1);
}

if (!inputUrl) {
  line("Result: No YouTube URL was supplied.");
  line("Run it like this:");
  line('  npm run api:check -- "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"');
  line("");
  line("Use a short video you own or are authorized to convert.");
  process.exit(1);
}

line("Key: present");
line(`Host: ${host}`);
line(`Test segment: ${startTime}s to ${endTime}s`);
line("Signed URLs and secrets will not be printed.");
line("");

const startResponse = await fetch(providerDownloadUrl(inputUrl), {
  method: "POST",
  headers: headers(),
  signal: AbortSignal.timeout(20_000),
});
const startBody = await readJson(startResponse);

if (!startResponse.ok) {
  const [title, detail] = explainHttpStatus(startResponse.status, startBody);
  line(`Result: ${title}`);
  line(detail);
  process.exit(1);
}

if (!startBody?.id) {
  line("Result: Provider responded, but no job id was found.");
  line("This means the provider schema changed and the adapter needs updating.");
  process.exit(1);
}

line("Start request: OK");
line("Provider job id: received privately");

for (let attempt = 1; attempt <= 12; attempt += 1) {
  await new Promise((resolve) =>
    setTimeout(resolve, attempt === 1 ? 1200 : 2500),
  );

  const statusResponse = await fetch(
    `https://${host}/status/${encodeURIComponent(startBody.id)}`,
    {
      method: "GET",
      headers: headers(),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const statusBody = await readJson(statusResponse);

  if (!statusResponse.ok) {
    const [title, detail] = explainHttpStatus(statusResponse.status, statusBody);
    line(`Result: ${title}`);
    line(detail);
    process.exit(1);
  }

  const providerStatus = statusBody?.status || "unknown";
  line(`Status poll ${attempt}: ${providerStatus}`);

  if (providerStatus === "CONVERSION_ERROR") {
    line("Result: Provider rejected this video/conversion.");
    line("Fix: try a different short authorized YouTube URL in the RapidAPI Playground first.");
    process.exit(1);
  }

  if (statusBody?.downloadUrl) {
    const resultUrl = new URL(statusBody.downloadUrl);
    line(`Result host: ${resultUrl.hostname}`);

    const fileResponse = await fetch(statusBody.downloadUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    const contentType = fileResponse.headers.get("content-type") || "";
    const contentLength = fileResponse.headers.get("content-length") || "unknown";

    if (fileResponse.ok && contentType.includes("audio/")) {
      line("Result: Success. A real MP3 is reachable from the provider.");
      line(`Content-Type: ${contentType}`);
      line(`Content-Length: ${contentLength}`);
      process.exit(0);
    }

    line("Result: Provider gave a download link, but the MP3 is not ready or is invalid.");
    line(`File HTTP status: ${fileResponse.status}`);
    line(`Content-Type: ${contentType || "none"}`);
  }
}

line("Result: Timed out waiting for a usable MP3.");
line("Try again later or try a different authorized YouTube URL.");
process.exit(1);
