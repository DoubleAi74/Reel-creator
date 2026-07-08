import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  YoutubeMp3ProviderError,
  buildDownloadRequestUrl,
  normalizeStartResponse,
  normalizeStatusResponse,
} from "../lib/youtube-mp3-provider.js";

async function readFixture(name) {
  const fixturePath = path.join(process.cwd(), "test", "fixtures", name);
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("buildDownloadRequestUrl uses the live query-parameter transport", () => {
  const url = buildDownloadRequestUrl(
    {
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      startTime: 30,
      endTime: 35,
    },
    {
      apiBaseUrl: "https://youtube-to-mp315.p.rapidapi.com",
    },
  );

  assert.equal(url.pathname, "/download");
  assert.equal(url.searchParams.get("url"), "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  assert.equal(url.searchParams.get("format"), "mp3");
  assert.equal(url.searchParams.get("startTime"), "30");
  assert.equal(url.searchParams.get("endTime"), "35");
});

test("normalizeStartResponse extracts the confirmed id field", async () => {
  const fixture = await readFixture("rapidapi-youtube-mp3-start.json");
  const result = normalizeStartResponse(fixture);

  assert.equal(result.providerJobId, fixture.id);
});

test("normalizeStatusResponse treats downloadUrl as complete even when status is CONVERTING", async () => {
  const fixture = await readFixture("rapidapi-youtube-mp3-complete.json");
  const result = normalizeStatusResponse(fixture);

  assert.equal(result.state, "complete");
  assert.equal(result.downloadUrl, "REDACTED");
  assert.equal(result.providerStatus, "CONVERTING");
});

test("normalizeStatusResponse treats CONVERTING without downloadUrl as processing", async () => {
  const fixture = await readFixture("rapidapi-youtube-mp3-complete.json");
  const result = normalizeStatusResponse({
    ...fixture,
    downloadUrl: null,
  });

  assert.equal(result.state, "processing");
  assert.equal(result.providerStatus, "CONVERTING");
});

test("normalizeStatusResponse recognizes provider failure statuses", () => {
  const result = normalizeStatusResponse({
    id: "example-id",
    status: "FAILED",
  });

  assert.equal(result.state, "failed");
});

test("normalizeStatusResponse treats CONVERSION_ERROR as failed even with downloadUrl", () => {
  const result = normalizeStatusResponse({
    id: "example-id",
    status: "CONVERSION_ERROR",
    downloadUrl: "http://78.141.232.210/example.mp3",
  });

  assert.equal(result.state, "failed");
  assert.equal(result.downloadUrl, undefined);
});

test("normalizeStartResponse rejects malformed success bodies", () => {
  assert.throws(
    () => normalizeStartResponse({ status: "CONVERTING" }),
    (error) =>
      error instanceof YoutubeMp3ProviderError &&
      error.errorCode === "PROVIDER_MALFORMED_RESPONSE",
  );
});
