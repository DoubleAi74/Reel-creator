import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Card } from "../models/Card.mjs";
import {
  createCardPlaceholderObject,
  deleteCardPlaceholderObject,
} from "./card-r2-lifecycle.mjs";
import { deleteR2Object, putR2Object } from "./r2-client.mjs";
import { R2ConfigError, resetR2EnvironmentForTests } from "./r2-env.mjs";

vi.mock("./r2-client.mjs", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    deleteR2Object: vi.fn(),
    putR2Object: vi.fn(),
  };
});

const cardId = "665f1c2b8f1b2a0012345678";
const objectKey = `cards/${cardId}/placeholder.json`;

function buildCard(overrides = {}) {
  return {
    _id: { toString: () => cardId },
    deletedAt: null,
    r2ObjectKey: objectKey,
    r2Status: "pending_create",
    ...overrides,
  };
}

let updateOneSpy;
let consoleErrorSpy;

beforeEach(() => {
  resetR2EnvironmentForTests();
  updateOneSpy = vi.spyOn(Card, "updateOne").mockResolvedValue({
    acknowledged: true,
  });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetR2EnvironmentForTests();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function enableR2() {
  vi.stubEnv("R2_ENABLED", "true");
  vi.stubEnv("R2_ACCOUNT_ID", "test-account-id");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-access-key");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
}

describe("createCardPlaceholderObject", () => {
  it("marks the card skipped without calling R2 when disabled", async () => {
    vi.stubEnv("R2_ENABLED", "false");

    const result = await createCardPlaceholderObject({ card: buildCard() });

    expect(result).toEqual({ key: objectKey, ok: true, skipped: true });
    expect(putR2Object).not.toHaveBeenCalled();
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $set: expect.objectContaining({ r2Status: "skipped" }),
      },
    );
  });

  it("skips creation entirely when the card is already soft-deleted", async () => {
    enableR2();

    const result = await createCardPlaceholderObject({
      card: buildCard({ deletedAt: new Date() }),
    });

    expect(result).toEqual({ key: objectKey, ok: true, skipped: true });
    expect(putR2Object).not.toHaveBeenCalled();
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("puts the placeholder and marks the card created on success", async () => {
    enableR2();
    putR2Object.mockResolvedValue({ key: objectKey, ok: true });

    const result = await createCardPlaceholderObject({ card: buildCard() });

    expect(result).toEqual({ key: objectKey, ok: true });
    expect(putR2Object).toHaveBeenCalledWith({
      body: expect.stringContaining(cardId),
      contentType: "text/html; charset=utf-8",
      key: objectKey,
      metadata: expect.objectContaining({ cardid: cardId }),
    });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: null,
          r2ObjectKey: objectKey,
          r2Status: "created",
        }),
      },
    );
  });

  it("marks create_failed with a safe code and never throws on R2 failure", async () => {
    enableR2();
    putR2Object.mockRejectedValue(
      Object.assign(new Error("secret-internal-detail"), {
        $metadata: { httpStatusCode: 403 },
        name: "AccessDenied",
      }),
    );

    const result = await createCardPlaceholderObject({ card: buildCard() });

    expect(result).toEqual({
      errorCode: "R2_ACCESS_DENIED",
      key: objectKey,
      ok: false,
    });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: "R2_ACCESS_DENIED",
          r2Status: "create_failed",
        }),
      },
    );

    const loggedPayload = JSON.stringify(consoleErrorSpy.mock.calls);
    expect(loggedPayload).toContain("R2_ACCESS_DENIED");
    expect(loggedPayload).not.toContain("test-secret-access-key");
  });

  it("maps missing config while enabled to create_failed R2_CONFIG_MISSING", async () => {
    enableR2();
    putR2Object.mockRejectedValue(new R2ConfigError("missing vars"));

    const result = await createCardPlaceholderObject({ card: buildCard() });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("R2_CONFIG_MISSING");
  });
});

describe("deleteCardPlaceholderObject", () => {
  it("treats cards without an object key as already clean", async () => {
    enableR2();

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2ObjectKey: null, r2Status: "not_required" }),
    });

    expect(result).toEqual({ key: null, ok: true, skipped: true });
    expect(deleteR2Object).not.toHaveBeenCalled();
  });

  it("treats skipped and not_required statuses as already clean", async () => {
    enableR2();

    for (const r2Status of ["skipped", "not_required", "deleted"]) {
      const result = await deleteCardPlaceholderObject({
        card: buildCard({ r2Status }),
      });

      expect(result).toEqual({ key: objectKey, ok: true, skipped: true });
    }

    expect(deleteR2Object).not.toHaveBeenCalled();
  });

  it("marks delete_failed R2_DISABLED when a real object cannot be reached", async () => {
    vi.stubEnv("R2_ENABLED", "false");

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2Status: "created" }),
    });

    expect(result).toEqual({
      errorCode: "R2_DISABLED",
      key: objectKey,
      ok: false,
    });
    expect(deleteR2Object).not.toHaveBeenCalled();
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({ r2Status: "delete_failed" }),
      },
    );
  });

  it("deletes the object and marks the card deleted", async () => {
    enableR2();
    deleteR2Object.mockResolvedValue({
      alreadyMissing: false,
      key: objectKey,
      ok: true,
    });

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2Status: "created" }),
    });

    expect(result).toEqual({ alreadyMissing: false, key: objectKey, ok: true });
    expect(deleteR2Object).toHaveBeenCalledWith({ key: objectKey });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: null,
          r2Status: "deleted",
        }),
      },
    );
  });

  it("treats an already-missing object as success", async () => {
    enableR2();
    deleteR2Object.mockResolvedValue({
      alreadyMissing: true,
      key: objectKey,
      ok: true,
    });

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2Status: "delete_failed" }),
    });

    expect(result).toEqual({ alreadyMissing: true, key: objectKey, ok: true });
  });

  it("attempts deletion for create_failed cards because the object may exist", async () => {
    enableR2();
    deleteR2Object.mockResolvedValue({
      alreadyMissing: true,
      key: objectKey,
      ok: true,
    });

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2Status: "create_failed" }),
    });

    expect(result.ok).toBe(true);
    expect(deleteR2Object).toHaveBeenCalledWith({ key: objectKey });
  });

  it("marks delete_failed with a safe code and never throws on R2 failure", async () => {
    enableR2();
    deleteR2Object.mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
    );

    const result = await deleteCardPlaceholderObject({
      card: buildCard({ r2Status: "created" }),
    });

    expect(result).toEqual({
      errorCode: "R2_TIMEOUT",
      key: objectKey,
      ok: false,
    });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: cardId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: "R2_TIMEOUT",
          r2Status: "delete_failed",
        }),
      },
    );
  });
});
