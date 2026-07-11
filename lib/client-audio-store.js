/**
 * Browser-side durable cache for session MP3s so playback survives reloads
 * even when Vercel /tmp session assets are gone.
 */

const DB_NAME = "reel-creator-audio-v1";
const DB_VERSION = 1;
const STORE_NAME = "audio";

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open audio cache."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "assetId" });
      }
    };
  });
}

function runStoreRequest(mode, runner) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request;

        try {
          request = runner(store);
        } catch (error) {
          reject(error);
          return;
        }

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error ?? new Error("Audio cache request failed."));
        };

        transaction.oncomplete = () => {
          database.close();
        };

        transaction.onerror = () => {
          reject(transaction.error ?? new Error("Audio cache transaction failed."));
        };
      }),
  );
}

/**
 * @param {{ assetId: string, blob: Blob, name?: string, mimeType?: string }} entry
 */
export async function putClientAudioBlob({ assetId, blob, mimeType, name }) {
  const safeAssetId = typeof assetId === "string" ? assetId.trim() : "";

  if (!safeAssetId) {
    throw new Error("assetId is required.");
  }

  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("A non-empty audio blob is required.");
  }

  const record = {
    assetId: safeAssetId,
    blob,
    mimeType:
      (typeof mimeType === "string" && mimeType.trim()) ||
      blob.type ||
      "audio/mpeg",
    name: typeof name === "string" && name.trim() ? name.trim() : "audio.mp3",
    sizeBytes: blob.size,
    updatedAt: Date.now(),
  };

  await runStoreRequest("readwrite", (store) => store.put(record));

  return {
    assetId: record.assetId,
    name: record.name,
    sizeBytes: record.sizeBytes,
  };
}

/**
 * @param {string} assetId
 * @returns {Promise<{ assetId: string, blob: Blob, mimeType: string, name: string } | null>}
 */
export async function getClientAudioBlob(assetId) {
  const safeAssetId = typeof assetId === "string" ? assetId.trim() : "";

  if (!safeAssetId) {
    return null;
  }

  try {
    const record = await runStoreRequest("readonly", (store) =>
      store.get(safeAssetId),
    );

    if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size === 0) {
      return null;
    }

    return {
      assetId: safeAssetId,
      blob: record.blob,
      mimeType:
        typeof record.mimeType === "string" && record.mimeType
          ? record.mimeType
          : "audio/mpeg",
      name:
        typeof record.name === "string" && record.name
          ? record.name
          : "audio.mp3",
    };
  } catch {
    return null;
  }
}

export async function deleteClientAudioBlob(assetId) {
  const safeAssetId = typeof assetId === "string" ? assetId.trim() : "";

  if (!safeAssetId) {
    return;
  }

  try {
    await runStoreRequest("readwrite", (store) => store.delete(safeAssetId));
  } catch {
    // best-effort
  }
}

/**
 * Build a File + object URL from a cached blob for transport / export.
 */
export function clientAudioRecordToFile(record) {
  if (!record?.blob) {
    return null;
  }

  const type = record.mimeType || "audio/mpeg";
  const name = record.name || "audio.mp3";

  return new File([record.blob], name, { type });
}
