import { describe, expect, it } from "vitest";

import {
  createTranscribeJob,
  findInFlightTranscribeForSession,
  getActiveJobSessionIds,
  getTranscribeJob,
  markTranscribeJobComplete,
  markTranscribeJobFailed,
  markTranscribeJobRunning,
  toTranscribeJobResponse,
} from "./transcribe-store";

describe("transcribe job store", () => {
  it("creates a queued job carrying its session and asset", () => {
    const sessionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const job = createTranscribeJob({ assetId, sessionId });

    expect(job.status).toBe("queued");
    expect(job.assetId).toBe(assetId);
    expect(job.sessionId).toBe(sessionId);
    expect(getTranscribeJob(job.jobId)).toMatchObject({ assetId, sessionId });
  });

  it("matches in-flight jobs by session AND asset, not session alone", () => {
    const sessionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const otherAssetId = crypto.randomUUID();
    const job = createTranscribeJob({ assetId, sessionId });

    markTranscribeJobRunning(job.jobId);

    expect(findInFlightTranscribeForSession(sessionId, assetId)?.jobId).toBe(
      job.jobId,
    );
    // Same session, different asset must not adopt the wrong job.
    expect(findInFlightTranscribeForSession(sessionId, otherAssetId)).toBeNull();
    // Different session, same asset must not match either.
    expect(
      findInFlightTranscribeForSession(crypto.randomUUID(), assetId),
    ).toBeNull();
  });

  it("reports active sessions and drops them once finished", () => {
    const sessionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const job = createTranscribeJob({ assetId, sessionId });

    markTranscribeJobRunning(job.jobId);
    expect(getActiveJobSessionIds()).toContain(sessionId);

    markTranscribeJobComplete(job.jobId, { lines: [] });
    expect(getActiveJobSessionIds()).not.toContain(sessionId);

    // A queued-but-not-running job still counts as active for sweep exemption.
    const queued = createTranscribeJob({
      assetId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });
    expect(getActiveJobSessionIds()).toContain(queued.sessionId);
  });

  it("surfaces the result only once the job is done", () => {
    const job = createTranscribeJob({
      assetId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });
    const result = { lines: [{ id: "line-1", original: "hi" }] };

    markTranscribeJobRunning(job.jobId);
    expect(toTranscribeJobResponse(getTranscribeJob(job.jobId))).not.toHaveProperty(
      "result",
    );

    markTranscribeJobComplete(job.jobId, result);
    const doneResponse = toTranscribeJobResponse(getTranscribeJob(job.jobId));
    expect(doneResponse.status).toBe("done");
    expect(doneResponse.progress).toBe(1);
    expect(doneResponse.result).toEqual(result);
  });

  it("records a failure message without a result", () => {
    const job = createTranscribeJob({
      assetId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });

    markTranscribeJobRunning(job.jobId);
    markTranscribeJobFailed(job.jobId, "boom");

    const response = toTranscribeJobResponse(getTranscribeJob(job.jobId));
    expect(response.status).toBe("error");
    expect(response.error).toBe("boom");
    expect(response).not.toHaveProperty("result");
  });
});
