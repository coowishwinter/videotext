import { MODEL_OPTIONS, ModelCacheInfo, TranscriptJob } from '../types/speech';

const DB_NAME = 'ShengJiSpeechToTextDB';
const DB_VERSION = 1;
const STORE_NAME = 'transcripts';

export interface PersistedTranscriptRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mediaKind: 'audio' | 'video';
  duration: number;
  segments: TranscriptJob['segments'];
  fullText: string;
  elapsedMs?: number;
  deviceUsed?: 'webgpu' | 'wasm';
  detectedLanguage?: string;
  modelUsed?: string;
  createdAt: number;
  completedAt?: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTranscriptToDB(job: TranscriptJob): Promise<void> {
  if (job.status !== 'completed') return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const record: PersistedTranscriptRecord = {
      id: job.id,
      fileName: job.fileName,
      fileSize: job.fileSize,
      mediaKind: job.mediaKind,
      duration: job.duration,
      segments: job.segments,
      fullText: job.fullText,
      elapsedMs: job.elapsedMs,
      deviceUsed: job.deviceUsed,
      detectedLanguage: job.detectedLanguage,
      modelUsed: job.modelUsed,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
    tx.objectStore(STORE_NAME).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB may be disabled in private browsing
  }
}

export async function loadTranscriptsFromDB(): Promise<TranscriptJob[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    const records = await new Promise<PersistedTranscriptRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();

    return records
      .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
      .map((rec) => ({
        ...rec,
        status: 'completed' as const,
        step: 'done' as const,
        progress: 100,
        statusText: '本地历史记录',
        liveText: '',
        isHistoryOnly: true,
      }));
  } catch {
    return [];
  }
}

export async function deleteTranscriptFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function inspectModelCaches(): Promise<Record<string, ModelCacheInfo>> {
  const result: Record<string, ModelCacheInfo> = {};
  for (const model of MODEL_OPTIONS) {
    result[model.id] = {
      modelId: model.id,
      cached: false,
      cachedBytes: 0,
      fileCount: 0,
    };
  }

  if (typeof caches === 'undefined') return result;

  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();

    for (const req of keys) {
      const url = req.url;
      for (const model of MODEL_OPTIONS) {
        if (url.includes(model.id)) {
          const entry = result[model.id];
          entry.fileCount += 1;
          const res = await cache.match(req);
          if (res) {
            const lenHeader = res.headers.get('content-length');
            if (lenHeader) {
              entry.cachedBytes += Number(lenHeader) || 0;
            } else {
              const buf = await res.clone().arrayBuffer();
              entry.cachedBytes += buf.byteLength;
            }
          }
        }
      }
    }

    for (const model of MODEL_OPTIONS) {
      const entry = result[model.id];
      entry.cached = entry.fileCount >= 3 && entry.cachedBytes > 5 * 1024 * 1024;
    }
  } catch {
    // Cache API unavailable
  }

  return result;
}

export async function clearModelCache(modelId?: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    if (!modelId) {
      await caches.delete('transformers-cache');
      return;
    }
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((k) => k.url.includes(modelId)).map((k) => cache.delete(k))
    );
  } catch {
    // ignore
  }
}
