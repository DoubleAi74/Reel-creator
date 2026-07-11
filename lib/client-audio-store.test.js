import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal in-memory IndexedDB stub for put/get/delete.
 */
function installMemoryIndexedDb() {
  const tables = new Map();

  class MemoryRequest {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }

    succeed(result) {
      this.result = result;
      queueMicrotask(() => this.onsuccess?.({ target: this }));
    }
  }

  class MemoryStore {
    constructor(name) {
      this.name = name;

      if (!tables.has(name)) {
        tables.set(name, new Map());
      }
    }

    get map() {
      return tables.get(this.name);
    }

    put(record) {
      const request = new MemoryRequest();
      this.map.set(record.assetId, record);
      request.succeed(record.assetId);
      return request;
    }

    get(assetId) {
      const request = new MemoryRequest();
      request.succeed(this.map.get(assetId));
      return request;
    }

    delete(assetId) {
      const request = new MemoryRequest();
      this.map.delete(assetId);
      request.succeed(undefined);
      return request;
    }
  }

  class MemoryTransaction {
    constructor(storeName) {
      this.storeName = storeName;
      this.oncomplete = null;
      this.onerror = null;
      queueMicrotask(() => this.oncomplete?.());
    }

    objectStore() {
      return new MemoryStore(this.storeName);
    }
  }

  class MemoryDatabase {
    constructor() {
      this.objectStoreNames = {
        contains: (name) => name === "audio",
      };
    }

    transaction(storeName) {
      return new MemoryTransaction(storeName);
    }

    close() {}

    createObjectStore() {}
  }

  class MemoryOpenRequest extends MemoryRequest {
    constructor() {
      super();
      this.onupgradeneeded = null;
    }
  }

  vi.stubGlobal("indexedDB", {
    open() {
      const request = new MemoryOpenRequest();
      const database = new MemoryDatabase();
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.({ target: request });
        request.succeed(database);
      });
      return request;
    },
  });
}

describe("client-audio-store", () => {
  beforeEach(() => {
    vi.resetModules();
    installMemoryIndexedDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores and retrieves an audio blob by assetId", async () => {
    const {
      clientAudioRecordToFile,
      getClientAudioBlob,
      putClientAudioBlob,
    } = await import("./client-audio-store.js");

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: "audio/mpeg",
    });

    await putClientAudioBlob({
      assetId: "asset-1",
      blob,
      mimeType: "audio/mpeg",
      name: "track.mp3",
    });

    const record = await getClientAudioBlob("asset-1");

    expect(record).toMatchObject({
      assetId: "asset-1",
      mimeType: "audio/mpeg",
      name: "track.mp3",
    });
    expect(record.blob.size).toBe(4);

    const file = clientAudioRecordToFile(record);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("track.mp3");
  });

  it("deletes a cached blob", async () => {
    const { deleteClientAudioBlob, getClientAudioBlob, putClientAudioBlob } =
      await import("./client-audio-store.js");

    await putClientAudioBlob({
      assetId: "asset-2",
      blob: new Blob([new Uint8Array([9])], { type: "audio/mpeg" }),
      name: "gone.mp3",
    });

    await deleteClientAudioBlob("asset-2");
    expect(await getClientAudioBlob("asset-2")).toBeNull();
  });
});
