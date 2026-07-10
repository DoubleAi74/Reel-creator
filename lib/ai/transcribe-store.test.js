import { describe, expect, it } from "vitest";

import {
  createTranscribeJob,
  findInFlightTranscribeForSession,
  getActiveJobSessionIds,
  getTranscribeJob,
  markTranscribeJobComplete,
  markTranscribeJobAccounting,
  markTranscribeJobFailed,
  markTranscribeJobRunning,
  toTranscribeJobResponse,
} from "./transcribe-store";

describe("transcribe job store", () => {
  it("creates a queued job carrying its session and asset", () => {
    const sessionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const job = createTranscribeJob({
      assetId,
      phase: "generate",
      pipelineRunId: "run-1",
      save: false,
      saveOnCompletion: true,
      sessionId,
    });

    expect(job.status).toBe("queued");
    expect(job.assetId).toBe(assetId);
    expect(job.accountingStatus).toBe("none");
    expect(job.phase).toBe("generate");
    expect(job.pipelineRunId).toBe("run-1");
    expect(job.save).toBe(false);
    expect(job.saveOnCompletion).toBe(true);
    expect(job.sessionId).toBe(sessionId);
    expect(getTranscribeJob(job.jobId)).toMatchObject({
      assetId,
      phase: "generate",
      sessionId,
    });
  });

  it("matches in-flight jobs by session, asset, and phase", () => {
    const sessionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const otherAssetId = crypto.randomUUID();
    const job = createTranscribeJob({ assetId, phase: "generate", sessionId });

    markTranscribeJobRunning(job.jobId);

    expect(
      findInFlightTranscribeForSession(sessionId, assetId, "generate")?.jobId,
    ).toBe(job.jobId);
    // Same session, different asset must not adopt the wrong job.
    expect(
      findInFlightTranscribeForSession(sessionId, otherAssetId, "generate"),
    ).toBeNull();
    // Same session and asset, different phase must not adopt the wrong job.
    expect(findInFlightTranscribeForSession(sessionId, assetId, "time")).toBeNull();
    // Different session, same asset must not match either.
    expect(
      findInFlightTranscribeForSession(crypto.randomUUID(), assetId, "generate"),
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
    expect(doneResponse.phase).toBe("full");
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

  it("surfaces accounting state to poll responses", () => {
    const job = createTranscribeJob({
      assetId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });

    markTranscribeJobAccounting(job.jobId, {
      error: "ACCOUNTING_CONFLICT",
      status: "unresolved",
    });

    expect(toTranscribeJobResponse(getTranscribeJob(job.jobId))).toMatchObject({
      accountingError: "ACCOUNTING_CONFLICT",
      accountingStatus: "unresolved",
      balanceExhausted: false,
      writeOffMinor: 0,
    });
  });

  it("surfaces balance-exhausted settlement fields on poll responses", () => {
    const job = createTranscribeJob({
      assetId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    });

    markTranscribeJobAccounting(job.jobId, {
      balanceExhausted: true,
      error: null,
      status: "settled",
      writeOffMinor: 7,
    });

    expect(toTranscribeJobResponse(getTranscribeJob(job.jobId))).toMatchObject({
      accountingError: null,
      accountingStatus: "settled",
      balanceExhausted: true,
      writeOffMinor: 7,
    });
  });
});
