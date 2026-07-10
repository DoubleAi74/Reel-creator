import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Generation } from "../models/Generation.js";
import {
  buildGenerationAudioObjectKey,
  deleteGenerationAudioObject,
  putGenerationAudioObject,
  reconcileGenerationAudio,
} from "./audio-r2-lifecycle.js";
import { deleteR2Object, headR2Object, putR2Object } from "./r2-client.js";
import { resetR2EnvironmentForTests } from "./r2-env.js";

vi.mock("./r2-client.js", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    deleteR2Object: vi.fn(),
    headR2Object: vi.fn(),
    putR2Object: vi.fn(),
  };
});

const generationId = "665f1c2b8f1b2a0012345678";
const objectKey = buildGenerationAudioObjectKey(generationId);

function buildGeneration(overrides = {}) {
  return {
    _id: { toString: () => generationId },
    deletedAt: null,
    r2ObjectKey: objectKey,
    r2Status: "pending_create",
    ...overrides,
  };
}

function enableR2() {
  vi.stubEnv("R2_ENABLED", "true");
  vi.stubEnv("R2_ACCOUNT_ID", "test-account-id");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-access-key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret-access-key");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
}

let tempRootDir = "";
let updateOneSpy;

beforeEach(async () => {
  resetR2EnvironmentForTests();
  tempRootDir = path.join(os.tmpdir(), `reel-r2-audio-test-${crypto.randomUUID()}`);
  await mkdir(tempRootDir, { recursive: true });
  updateOneSpy = vi.spyOn(Generation, "updateOne").mockResolvedValue({
    acknowledged: true,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await rm(tempRootDir, { force: true, recursive: true });
  resetR2EnvironmentForTests();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

async function writeMp3Fixture(name = "song.mp3") {
  const filePath = path.join(tempRootDir, name);
  await writeFile(filePath, Buffer.from("ID3stage5-audio"));

  return filePath;
}

describe("generation audio R2 lifecycle", () => {
  it("marks saved generations create_failed when R2 is disabled", async () => {
    vi.stubEnv("R2_ENABLED", "false");

    const result = await putGenerationAudioObject({
      filePath: await writeMp3Fixture(),
      generation: buildGeneration(),
    });

    expect(result).toEqual({
      errorCode: "R2_DISABLED",
      key: objectKey,
      ok: false,
    });
    expect(putR2Object).not.toHaveBeenCalled();
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: generationId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: "R2_DISABLED",
          r2Status: "create_failed",
        }),
      },
    );
  });

  it("streams the MP3 to R2 and marks the generation created", async () => {
    enableR2();
    putR2Object.mockResolvedValue({ key: objectKey, ok: true });

    const result = await putGenerationAudioObject({
      contentType: "audio/mpeg",
      filePath: await writeMp3Fixture(),
      generation: buildGeneration(),
    });

    expect(result).toEqual({ key: objectKey, ok: true });
    expect(putR2Object).toHaveBeenCalledWith(
      expect.objectContaining({
        contentLength: Buffer.byteLength("ID3stage5-audio"),
        contentType: "audio/mpeg",
        key: objectKey,
        metadata: { generationid: generationId },
      }),
    );
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: generationId },
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

  it("marks create_failed with safe codes on R2 put failure", async () => {
    enableR2();
    putR2Object.mockRejectedValue(
      Object.assign(new Error("secret"), {
        $metadata: { httpStatusCode: 403 },
        name: "AccessDenied",
      }),
    );

    const result = await putGenerationAudioObject({
      filePath: await writeMp3Fixture(),
      generation: buildGeneration(),
    });

    expect(result).toEqual({
      errorCode: "R2_ACCESS_DENIED",
      key: objectKey,
      ok: false,
    });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: generationId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: "R2_ACCESS_DENIED",
          r2Status: "create_failed",
        }),
      },
    );
  });

  it("repairs pending status when HEAD finds an existing object", async () => {
    enableR2();
    headR2Object.mockResolvedValue({ exists: true, key: objectKey });

    const result = await reconcileGenerationAudio({
      generation: buildGeneration({ r2Status: "pending_create" }),
    });

    expect(result).toEqual({ key: objectKey, ok: true, reconciled: true });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: generationId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: null,
          r2Status: "created",
        }),
      },
    );
  });

  it("deletes existing R2 objects before marking the generation deleted", async () => {
    enableR2();
    deleteR2Object.mockResolvedValue({
      alreadyMissing: false,
      key: objectKey,
      ok: true,
    });

    const result = await deleteGenerationAudioObject({
      generation: buildGeneration({ r2Status: "created" }),
    });

    expect(result).toEqual({ alreadyMissing: false, key: objectKey, ok: true });
    expect(deleteR2Object).toHaveBeenCalledWith({ key: objectKey });
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: generationId },
      {
        $inc: { r2AttemptCount: 1 },
        $set: expect.objectContaining({
          r2ErrorCode: null,
          r2Status: "deleted",
        }),
      },
    );
  });
});
