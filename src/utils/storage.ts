import {
  AudioSegmentBound,
  MODEL_OPTIONS,
  ModelCacheInfo,
  TranscriptJob,
  TranscriptSegment,
  WhisperModelId,
} from '../types/speech';
import { formatSegmentsText } from './textFormatter';

const DB_NAME = 'ShengJiSpeechToTextDB';
const DB_VERSION = 2;
const STORE_NAME = 'transcripts';
const CHECKPOINT_META_STORE = 'checkpoint_meta';
const CHECKPOINT_AUDIO_STORE = 'checkpoint_audio';
const CHECKPOINT_CHUNK_SAMPLES = 16000 * 300; // 5 minutes per chunk (~9.6 MB Int16)

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

export interface CheckpointMetaRecord {
  jobId: string;
  fileName: string;
  fileSize: number;
  mediaKind: 'audio' | 'video';
  duration: number;
  modelId: WhisperModelId;
  language: string;
  totalSamples: number;
  chunkCount: number;
  totalSegments: number;
  nextSegmentIndex: number;
  segments: TranscriptSegment[];
  segmentBounds: AudioSegmentBound[];
  detectedLanguage?: string;
  elapsedMsSoFar: number;
  createdAt: number;
  updatedAt: number;
}

interface CheckpointAudioChunkRecord {
  key: string;
  jobId: string;
  chunkIdx: number;
  buffer: ArrayBuffer;
}

export interface LoadedCheckpointData {
  audioData: Float32Array;
  duration: number;
  modelId: WhisperModelId;
  language: string;
  totalSegments: number;
  nextSegmentIndex: number;
  segments: TranscriptSegment[];
  segmentBounds: AudioSegmentBound[];
  detectedLanguage?: string;
  elapsedMsSoFar: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHECKPOINT_META_STORE)) {
        db.createObjectStore(CHECKPOINT_META_STORE, { keyPath: 'jobId' });
      }
      if (!db.objectStoreNames.contains(CHECKPOINT_AUDIO_STORE)) {
        const audioStore = db.createObjectStore(CHECKPOINT_AUDIO_STORE, { keyPath: 'key' });
        audioStore.createIndex('by_jobId', 'jobId', { unique: false });
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

export async function deleteCheckpointFromDB(jobId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([CHECKPOINT_META_STORE, CHECKPOINT_AUDIO_STORE], 'readwrite');
    tx.objectStore(CHECKPOINT_META_STORE).delete(jobId);

    const audioStore = tx.objectStore(CHECKPOINT_AUDIO_STORE);
    const index = audioStore.index('by_jobId');
    const keyCursorReq = index.openKeyCursor(IDBKeyRange.only(jobId));
    keyCursorReq.onsuccess = () => {
      const cursor = keyCursorReq.result;
      if (cursor) {
        audioStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function saveCheckpointAudioAndMeta(
  job: Pick<TranscriptJob, 'id' | 'fileName' | 'fileSize' | 'mediaKind' | 'duration' | 'createdAt'>,
  audioData: Float32Array,
  modelId: WhisperModelId,
  language: string
): Promise<boolean> {
  if (audioData.length === 0) return false;
  let db: IDBDatabase | null = null;
  try {
    await deleteCheckpointFromDB(job.id);
    db = await openDB();
    const totalSamples = audioData.length;
    const chunkCount = Math.ceil(totalSamples / CHECKPOINT_CHUNK_SAMPLES);

    for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
      const start = chunkIdx * CHECKPOINT_CHUNK_SAMPLES;
      const end = Math.min(totalSamples, start + CHECKPOINT_CHUNK_SAMPLES);
      const len = end - start;
      const int16 = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        const v = audioData[start + i];
        const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
        int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      }

      const tx = db.transaction(CHECKPOINT_AUDIO_STORE, 'readwrite');
      const chunkRecord: CheckpointAudioChunkRecord = {
        key: `${job.id}::${chunkIdx}`,
        jobId: job.id,
        chunkIdx,
        buffer: int16.buffer,
      };
      tx.objectStore(CHECKPOINT_AUDIO_STORE).put(chunkRecord);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    const meta: CheckpointMetaRecord = {
      jobId: job.id,
      fileName: job.fileName,
      fileSize: job.fileSize,
      mediaKind: job.mediaKind,
      duration: job.duration,
      modelId,
      language,
      totalSamples,
      chunkCount,
      totalSegments: 0,
      nextSegmentIndex: 0,
      segments: [],
      segmentBounds: [],
      elapsedMsSoFar: 0,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
    };

    const metaTx = db.transaction(CHECKPOINT_META_STORE, 'readwrite');
    metaTx.objectStore(CHECKPOINT_META_STORE).put(meta);
    await new Promise<void>((resolve, reject) => {
      metaTx.oncomplete = () => resolve();
      metaTx.onerror = () => reject(metaTx.error);
    });

    db.close();
    return true;
  } catch {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    await deleteCheckpointFromDB(job.id);
    return false;
  }
}

export async function updateCheckpointStartMeta(
  jobId: string,
  totalSegments: number,
  segmentBounds: AudioSegmentBound[],
  detectedLanguage?: string
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(CHECKPOINT_META_STORE, 'readwrite');
    const store = tx.objectStore(CHECKPOINT_META_STORE);
    const getReq = store.get(jobId);
    getReq.onsuccess = () => {
      const existing = getReq.result as CheckpointMetaRecord | undefined;
      if (!existing) return;
      store.put({
        ...existing,
        totalSegments,
        segmentBounds,
        detectedLanguage: detectedLanguage ?? existing.detectedLanguage,
        updatedAt: Date.now(),
      } satisfies CheckpointMetaRecord);
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function updateCheckpointProgress(
  jobId: string,
  nextSegmentIndex: number,
  segments: TranscriptSegment[],
  detectedLanguage: string | undefined,
  elapsedMsSoFar: number
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(CHECKPOINT_META_STORE, 'readwrite');
    const store = tx.objectStore(CHECKPOINT_META_STORE);
    const getReq = store.get(jobId);
    getReq.onsuccess = () => {
      const existing = getReq.result as CheckpointMetaRecord | undefined;
      if (!existing) return;
      store.put({
        ...existing,
        nextSegmentIndex,
        segments,
        detectedLanguage: detectedLanguage ?? existing.detectedLanguage,
        elapsedMsSoFar,
        updatedAt: Date.now(),
      } satisfies CheckpointMetaRecord);
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function loadCheckpointsFromDB(): Promise<TranscriptJob[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(CHECKPOINT_META_STORE, 'readonly');
    const req = tx.objectStore(CHECKPOINT_META_STORE).getAll();
    const records = await new Promise<CheckpointMetaRecord[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();

    return records
      .filter((rec) => rec.chunkCount > 0 && rec.totalSamples > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((rec) => {
        const pct =
          rec.totalSegments > 0
            ? Math.min(99, Math.max(5, Math.round((rec.nextSegmentIndex / rec.totalSegments) * 100)))
            : 10;
        const statusText =
          rec.totalSegments > 0
            ? `已从本地断点恢复（已完成 ${rec.nextSegmentIndex}/${rec.totalSegments} 段 · ${pct}%），点击「继续转写」接着识别`
            : '已恢复本地音频缓存，点击「继续转写」即可接着识别（完成后自动清理缓存）';
        return {
          id: rec.jobId,
          fileName: rec.fileName,
          fileSize: rec.fileSize,
          mediaKind: rec.mediaKind,
          duration: rec.duration,
          status: 'interrupted' as const,
          step: rec.totalSegments > 0 ? ('transcribing' as const) : ('idle' as const),
          progress: pct,
          statusText,
          liveText: '',
          segments: rec.segments || [],
          fullText: formatSegmentsText(rec.segments || [], '', false),
          elapsedMsSoFar: rec.elapsedMsSoFar,
          detectedLanguage: rec.detectedLanguage,
          modelUsed: rec.modelId,
          createdAt: rec.createdAt,
          hasCheckpoint: true,
          checkpointDoneSegments: rec.nextSegmentIndex,
          checkpointTotalSegments: rec.totalSegments,
          checkpointModelId: rec.modelId,
          checkpointLanguage: rec.language,
        };
      });
  } catch {
    return [];
  }
}

export async function loadCheckpointAudioData(jobId: string): Promise<LoadedCheckpointData | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const metaTx = db.transaction(CHECKPOINT_META_STORE, 'readonly');
    const metaReq = metaTx.objectStore(CHECKPOINT_META_STORE).get(jobId);
    const meta = await new Promise<CheckpointMetaRecord | undefined>((resolve, reject) => {
      metaReq.onsuccess = () => resolve(metaReq.result as CheckpointMetaRecord | undefined);
      metaReq.onerror = () => reject(metaReq.error);
    });

    if (!meta || meta.totalSamples <= 0 || meta.chunkCount <= 0) {
      db.close();
      return null;
    }

    const audioData = new Float32Array(meta.totalSamples);
    let writeOffset = 0;

    for (let chunkIdx = 0; chunkIdx < meta.chunkCount; chunkIdx++) {
      const tx = db.transaction(CHECKPOINT_AUDIO_STORE, 'readonly');
      const req = tx.objectStore(CHECKPOINT_AUDIO_STORE).get(`${jobId}::${chunkIdx}`);
      const rec = await new Promise<CheckpointAudioChunkRecord | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as CheckpointAudioChunkRecord | undefined);
        req.onerror = () => reject(req.error);
      });

      if (!rec || !rec.buffer) {
        db.close();
        return null;
      }

      const int16 = new Int16Array(rec.buffer);
      for (let i = 0; i < int16.length && writeOffset + i < meta.totalSamples; i++) {
        audioData[writeOffset + i] = int16[i] / 32768;
      }
      writeOffset += int16.length;
    }

    db.close();
    return {
      audioData,
      duration: meta.duration,
      modelId: meta.modelId,
      language: meta.language,
      totalSegments: meta.totalSegments,
      nextSegmentIndex: meta.nextSegmentIndex,
      segments: meta.segments || [],
      segmentBounds: meta.segmentBounds || [],
      detectedLanguage: meta.detectedLanguage,
      elapsedMsSoFar: meta.elapsedMsSoFar || 0,
    };
  } catch {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    return null;
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
