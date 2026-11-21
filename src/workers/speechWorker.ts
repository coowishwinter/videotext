import { TextStreamer, env, pipeline } from '@huggingface/transformers';
import * as OpenCC_T2CN from 'opencc-js/t2cn';
import * as OpenCC_CN2T from 'opencc-js/cn2t';
import { MODEL_OPTIONS } from '../types/speech';

const toSimplified = OpenCC_T2CN.Converter({ from: 't', to: 'cn' });
const toTraditional = OpenCC_CN2T.Converter({ from: 'cn', to: 't' });

export interface WorkerLocalFileEntry {
  relativePath: string;
  file: File;
}

export type SpeechWorkerIncoming =
  | {
      type: 'detect-capabilities';
    }
  | {
      type: 'register-local-model';
      modelName: string;
      files: WorkerLocalFileEntry[];
    }
  | {
      type: 'clear-local-model';
    }
  | {
      type: 'preload-model';
      modelId: string;
      device: 'auto' | 'webgpu' | 'wasm';
      remoteHost: string;
      offlineOnly: boolean;
    }
  | {
      type: 'transcribe';
      taskId: string;
      audioData: Float32Array;
      duration: number;
      modelId: string;
      device: 'auto' | 'webgpu' | 'wasm';
      language: string;
      remoteHost: string;
      offlineOnly: boolean;
      useLocalFolderModel: boolean;
    };

export type SpeechWorkerOutgoing =
  | {
      type: 'capabilities';
      webgpuSupported: boolean;
    }
  | {
      type: 'local-model-registered';
      modelName: string;
      fileCount: number;
    }
  | {
      type: 'model-progress';
      modelId: string;
      status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
      file: string;
      progress: number;
      loaded: number;
      total: number;
    }
  | {
      type: 'model-ready';
      modelId: string;
      deviceUsed: 'webgpu' | 'wasm';
    }
  | {
      type: 'model-error';
      modelId: string;
      error: string;
    }
  | {
      type: 'transcribe-progress';
      taskId: string;
      progress: number;
      segmentIndex: number;
      totalSegments: number;
      liveText: string;
      segments: Array<{ id: string; startSec: number; endSec: number; text: string }>;
      detectedLanguage?: string;
    }
  | {
      type: 'transcribe-result';
      taskId: string;
      text: string;
      segments: Array<{ id: string; startSec: number; endSec: number; text: string }>;
      deviceUsed: 'webgpu' | 'wasm';
      detectedLanguage?: string;
    }
  | {
      type: 'transcribe-error';
      taskId: string;
      error: string;
    };

const LOCAL_MODEL_VIRTUAL_ID = 'local-disk/whisper-custom';
const originalFetch = self.fetch.bind(self);
const localFilesMap = new Map<string, File>();

// Initialize local ONNX Runtime WASM paths ONCE so ensureWasmLoaded blob cache isn't overwritten
if (env.backends.onnx?.wasm) {
  const origin = self.location.origin;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

function configureEnvironment(remoteHost: string, offlineOnly: boolean, useLocalFolder: boolean) {
  env.useBrowserCache = true;
  env.cacheKey = 'transformers-cache';
  env.allowLocalModels = false;
  env.allowRemoteModels = useLocalFolder ? true : !offlineOnly;

  if (remoteHost && remoteHost.trim()) {
    const normalized = remoteHost.trim().endsWith('/')
      ? remoteHost.trim()
      : `${remoteHost.trim()}/`;
    env.remoteHost = normalized;
  }

  const mirrorHosts = ['https://hf-mirror.com/', 'https://huggingface.co/'];

  env.fetch = async (input: string | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString();

    if (useLocalFolder && localFilesMap.size > 0 && urlStr.includes(LOCAL_MODEL_VIRTUAL_ID)) {
      const marker = '/resolve/main/';
      const markerIdx = urlStr.indexOf(marker);
      let relPath = markerIdx >= 0 ? urlStr.slice(markerIdx + marker.length) : urlStr;
      relPath = relPath.split('?')[0].replace(/^\/+/, '');

      const matchedFile = findLocalFile(relPath);
      if (matchedFile) {
        return new Response(matchedFile, {
          status: 200,
          headers: {
            'content-length': String(matchedFile.size),
            'content-type': relPath.endsWith('.json')
              ? 'application/json'
              : 'application/octet-stream',
          },
        });
      }
      return new Response('Local model file not found: ' + relPath, { status: 404 });
    }

    const hostsToTry: string[] = [];
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      hostsToTry.push(urlStr);
      for (const mHost of mirrorHosts) {
        for (const oldHost of mirrorHosts) {
          if (urlStr.startsWith(oldHost)) {
            const subPath = urlStr.slice(oldHost.length);
            hostsToTry.push(mHost + subPath);
          }
        }
      }
    } else {
      hostsToTry.push(urlStr);
    }

    const uniqueUrls = Array.from(new Set(hostsToTry));
    let lastErr: any = null;

    for (const testUrl of uniqueUrls) {
      try {
        const resp = await originalFetch(testUrl, init);
        if (resp.ok) {
          return resp;
        }
        lastErr = new Error(`HTTP error status: ${resp.status}`);
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('Failed to fetch resource across all mirror sources.');
  };
}

function findLocalFile(relPath: string): File | undefined {
  if (localFilesMap.has(relPath)) return localFilesMap.get(relPath);
  const fileNameOnly = relPath.split('/').pop() || relPath;
  for (const [key, file] of localFilesMap.entries()) {
    if (key.endsWith(`/${relPath}`) || key === fileNameOnly || key.endsWith(`/${fileNameOnly}`)) {
      return file;
    }
  }
  return undefined;
}

async function detectWebGpuSupport(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } })
      .gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePipeline: any = null;
let activePipelineKey = '';
let activeDeviceUsed: 'webgpu' | 'wasm' = 'wasm';

async function getOrCreatePipeline(
  modelId: string,
  requestedDevice: 'auto' | 'webgpu' | 'wasm',
  remoteHost: string,
  offlineOnly: boolean,
  useLocalFolder: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ pipe: any; deviceUsed: 'webgpu' | 'wasm' }> {
  const effectiveUseLocal = useLocalFolder && localFilesMap.size > 0;
  const effectiveModelId = effectiveUseLocal ? LOCAL_MODEL_VIRTUAL_ID : modelId;
  configureEnvironment(remoteHost, offlineOnly, effectiveUseLocal);

  let targetDevice: 'webgpu' | 'wasm' = 'wasm';
  if (requestedDevice === 'webgpu') {
    targetDevice = 'webgpu';
  } else if (requestedDevice === 'auto') {
    targetDevice = (await detectWebGpuSupport()) ? 'webgpu' : 'wasm';
  }

  const key = `${effectiveModelId}::${targetDevice}::${remoteHost}::${offlineOnly}::${
    effectiveUseLocal ? localFilesMap.size : 0
  }`;
  if (activePipeline && activePipelineKey === key) {
    return { pipe: activePipeline, deviceUsed: activeDeviceUsed };
  }

  if (activePipeline) {
    try {
      await activePipeline.dispose();
    } catch {
      // ignore dispose errors
    }
    activePipeline = null;
    activePipelineKey = '';
  }

  const modelOption = MODEL_OPTIONS.find((m) => m.id === modelId);
  const fileProgressMap = new Map<string, { loaded: number; total: number }>();

  const progress_callback = (info: {
    status: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  }) => {
    const file = info.file || '';
    if (info.status === 'progress' && file) {
      fileProgressMap.set(file, {
        loaded: info.loaded ?? 0,
        total: info.total ?? 0,
      });
    } else if (info.status === 'done' && file) {
      const existing = fileProgressMap.get(file);
      if (existing && existing.total > 0) {
        fileProgressMap.set(file, { loaded: existing.total, total: existing.total });
      }
    }

    let sumLoaded = 0;
    let sumTotal = 0;
    for (const item of fileProgressMap.values()) {
      sumLoaded += item.loaded;
      sumTotal += item.total;
    }

    const overallProgress =
      sumTotal > 0
        ? Math.min(99, Math.round((sumLoaded / sumTotal) * 100))
        : Math.round(info.progress ?? 0);

    self.postMessage({
      type: 'model-progress',
      modelId,
      status: (info.status as 'initiate' | 'download' | 'progress' | 'done' | 'ready') || 'progress',
      file,
      progress: info.status === 'ready' ? 100 : overallProgress,
      loaded: sumLoaded,
      total: sumTotal,
    } satisfies SpeechWorkerOutgoing);
  };

  const loadWithDevice = async (dev: 'webgpu' | 'wasm') => {
    const dtype =
      dev === 'webgpu'
        ? modelOption?.webgpuDtype ?? { encoder_model: 'fp32', decoder_model_merged: 'fp32' }
        : modelOption?.wasmDtype ?? { encoder_model: 'q8', decoder_model_merged: 'q8' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (pipeline as any)('automatic-speech-recognition', effectiveModelId, {
      device: dev,
      dtype,
      local_files_only: effectiveUseLocal ? false : offlineOnly,
      progress_callback,
    });
  };

  try {
    activePipeline = await loadWithDevice(targetDevice);
    activeDeviceUsed = targetDevice;
    activePipelineKey = key;
  } catch (err) {
    if (targetDevice === 'webgpu') {
      activePipeline = await loadWithDevice('wasm');
      activeDeviceUsed = 'wasm';
      activePipelineKey = `${effectiveModelId}::wasm::${remoteHost}::${offlineOnly}::${
        effectiveUseLocal ? localFilesMap.size : 0
      }`;
    } else {
      throw err;
    }
  }

  return { pipe: activePipeline, deviceUsed: activeDeviceUsed };
}

interface AudioSegment {
  startSample: number;
  endSample: number;
  startSec: number;
  endSec: number;
  isSilent: boolean;
}

function computeRms(data: Float32Array, start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < end; i += 4) {
    const v = data[i];
    sumSq += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

/**
 * Splits 16kHz mono audio cleanly into <=24s segments along silence valleys,
 * avoiding tiny <4s trailing stubs that cause Whisper zero-padding hallucinations.
 */
function splitAudioSegments(audio: Float32Array, sampleRate = 16000): AudioSegment[] {
  const maxSamples = Math.floor(24 * sampleRate);
  const minSplitSamples = Math.floor(14 * sampleRate);
  const minTailSamples = Math.floor(4 * sampleRate);
  const frameSamples = Math.floor(0.1 * sampleRate);
  const silenceRmsThreshold = 0.002;

  if (audio.length <= maxSamples) {
    const rms = computeRms(audio, 0, audio.length);
    return [
      {
        startSample: 0,
        endSample: audio.length,
        startSec: 0,
        endSec: audio.length / sampleRate,
        isSilent: rms < silenceRmsThreshold,
      },
    ];
  }

  const segments: AudioSegment[] = [];
  let cursor = 0;

  while (cursor < audio.length) {
    const remaining = audio.length - cursor;
    if (remaining <= maxSamples) {
      const rms = computeRms(audio, cursor, audio.length);
      segments.push({
        startSample: cursor,
        endSample: audio.length,
        startSec: cursor / sampleRate,
        endSec: audio.length / sampleRate,
        isSilent: rms < silenceRmsThreshold,
      });
      break;
    }

    let searchStart = cursor + minSplitSamples;
    let searchEnd = cursor + maxSamples;
    if (remaining < maxSamples + minTailSamples) {
      const mid = cursor + Math.floor(remaining / 2);
      searchStart = Math.max(cursor + Math.floor(6 * sampleRate), mid - 3 * sampleRate);
      searchEnd = Math.min(cursor + maxSamples, mid + 3 * sampleRate);
    }

    let bestSplit = searchEnd;
    let lowestRms = Infinity;

    for (let pos = searchStart; pos + frameSamples <= searchEnd; pos += frameSamples) {
      const rms = computeRms(audio, pos, pos + frameSamples);
      if (rms < lowestRms) {
        lowestRms = rms;
        bestSplit = pos + Math.floor(frameSamples / 2);
      }
    }

    const segRms = computeRms(audio, cursor, bestSplit);
    segments.push({
      startSample: cursor,
      endSample: bestSplit,
      startSec: cursor / sampleRate,
      endSec: bestSplit / sampleRate,
      isSilent: segRms < silenceRmsThreshold,
    });
    cursor = bestSplit;
  }

  return segments;
}

const LANGUAGE_NAME_TO_SHORT: Record<string, string> = {
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  chinese: 'zh',
  english: 'en',
  japanese: 'ja',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  spanish: 'es',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectLanguageCode(pipe: any, sampleAudio: Float32Array): Promise<string> {
  try {
    const model = pipe.model;
    const processor = pipe.processor;
    const genConfig = model?.generation_config;
    if (!genConfig?.is_multilingual || !genConfig?.lang_to_id) {
      return 'en';
    }

    const sotId = Number(genConfig.decoder_start_token_id);
    const slice = sampleAudio.subarray(0, Math.min(sampleAudio.length, 16000 * 15));
    const feat = await processor(slice);
    const out = await model.generate({
      inputs: feat.input_features,
      decoder_input_ids: [[sotId]],
      max_new_tokens: 1,
      return_timestamps: false,
    });
    const seq = out[0].tolist().map(Number);
    const predictedLangTokenId = seq[seq.length - 1];

    for (const [tokenStr, id] of Object.entries(genConfig.lang_to_id as Record<string, number>)) {
      if (Number(id) === predictedLangTokenId) {
        return tokenStr.replace(/^<\|/, '').replace(/\|>$/, '');
      }
    }
  } catch {
    // Fallback safely to Chinese
  }
  return 'zh';
}

function cleanDecodedText(text: string, targetScript: 'hans' | 'hant' | 'raw'): string {
  const spaced = text
    .trim()
    .replace(
      /([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])\s+([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])/g,
      '$1$2'
    )
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/(.{4,36}?)\1{2,}/g, '$1')
    .trim();

  if (!spaced) return '';
  if (targetScript === 'hans') return toSimplified(spaced);
  if (targetScript === 'hant') return toTraditional(spaced);
  return spaced;
}

self.onmessage = async (event: MessageEvent<SpeechWorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === 'detect-capabilities') {
    const webgpuSupported = await detectWebGpuSupport();
    self.postMessage({
      type: 'capabilities',
      webgpuSupported,
    } satisfies SpeechWorkerOutgoing);
    return;
  }

  if (msg.type === 'register-local-model') {
    localFilesMap.clear();
    for (const entry of msg.files) {
      const normalizedPath = entry.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const slashIdx = normalizedPath.indexOf('/');
      const trimmed = slashIdx >= 0 ? normalizedPath.slice(slashIdx + 1) : normalizedPath;
      if (trimmed) {
        localFilesMap.set(trimmed, entry.file);
      }
      localFilesMap.set(normalizedPath, entry.file);
    }
    activePipelineKey = '';
    self.postMessage({
      type: 'local-model-registered',
      modelName: msg.modelName,
      fileCount: msg.files.length,
    } satisfies SpeechWorkerOutgoing);
    return;
  }

  if (msg.type === 'clear-local-model') {
    localFilesMap.clear();
    activePipelineKey = '';
    return;
  }

  if (msg.type === 'preload-model') {
    try {
      const { deviceUsed } = await getOrCreatePipeline(
        msg.modelId,
        msg.device,
        msg.remoteHost,
        msg.offlineOnly,
        false
      );
      self.postMessage({
        type: 'model-ready',
        modelId: msg.modelId,
        deviceUsed,
      } satisfies SpeechWorkerOutgoing);
    } catch (err) {
      self.postMessage({
        type: 'model-error',
        modelId: msg.modelId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SpeechWorkerOutgoing);
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      let { pipe, deviceUsed } = await getOrCreatePipeline(
        msg.modelId,
        msg.device,
        msg.remoteHost,
        msg.offlineOnly,
        msg.useLocalFolderModel
      );

      self.postMessage({
        type: 'model-ready',
        modelId: msg.modelId,
        deviceUsed,
      } satisfies SpeechWorkerOutgoing);

      const samplingRate = 16000;
      const segments = splitAudioSegments(msg.audioData, samplingRate);
      const totalSegments = segments.length;

      let langCode = LANGUAGE_NAME_TO_SHORT[msg.language] ?? msg.language;
      if (!msg.language || msg.language === 'auto') {
        const firstActive = segments.find((s) => !s.isSilent) ?? segments[0];
        const sampleSlice = msg.audioData.subarray(firstActive.startSample, firstActive.endSample);
        langCode = await detectLanguageCode(pipe, sampleSlice);
      }

      const targetScript: 'hans' | 'hant' | 'raw' =
        msg.language === 'zh-hans' || (msg.language === 'auto' && langCode === 'zh')
          ? 'hans'
          : msg.language === 'zh-hant'
            ? 'hant'
            : 'raw';

      const recognizedSegments: Array<{
        id: string;
        startSec: number;
        endSec: number;
        text: string;
      }> = [];

      for (let idx = 0; idx < totalSegments; idx++) {
        const seg = segments[idx];
        const segDuration = (seg.endSample - seg.startSample) / samplingRate;

        if (!seg.isSilent && segDuration >= 0.25) {
          const segAudio = msg.audioData.subarray(seg.startSample, seg.endSample);
          const maxNewTokens = Math.min(200, Math.max(24, Math.ceil(segDuration * 10) + 12));

          let streamBuf = '';
          let lastPostTime = 0;

          const createStreamer = () =>
            new TextStreamer(pipe.tokenizer, {
              skip_prompt: true,
              skip_special_tokens: true,
              callback_function: (chunkText: string) => {
                streamBuf += chunkText;
                const now = performance.now();
                if (now - lastPostTime > 280) {
                  lastPostTime = now;
                  const basePct = Math.round((idx / totalSegments) * 100);
                  const liveClean = cleanDecodedText(streamBuf, targetScript);
                  self.postMessage({
                    type: 'transcribe-progress',
                    taskId: msg.taskId,
                    progress: Math.min(99, Math.max(5, basePct + 2)),
                    segmentIndex: idx + 1,
                    totalSegments,
                    liveText: liveClean,
                    segments: recognizedSegments,
                    detectedLanguage: langCode,
                  } satisfies SpeechWorkerOutgoing);
                }
              },
            });

          const runInference = async () =>
            await pipe(segAudio, {
              language: langCode,
              task: 'transcribe',
              return_timestamps: false,
              max_new_tokens: maxNewTokens,
              no_repeat_ngram_size: 5,
              repetition_penalty: 1.15,
              streamer: createStreamer(),
            });

          let result: { text?: string };
          try {
            result = await runInference();
          } catch (inferErr) {
            // If WebGPU fails mid-inference (driver/shader/OOM issue), transparently fall back to WASM CPU
            if (deviceUsed === 'webgpu') {
              streamBuf = '';
              const fallback = await getOrCreatePipeline(
                msg.modelId,
                'wasm',
                msg.remoteHost,
                msg.offlineOnly,
                msg.useLocalFolderModel
              );
              pipe = fallback.pipe;
              deviceUsed = fallback.deviceUsed;
              result = await runInference();
            } else {
              throw inferErr;
            }
          }

          const clean = cleanDecodedText(result?.text || streamBuf || '', targetScript);
          const prevText =
            recognizedSegments.length > 0
              ? recognizedSegments[recognizedSegments.length - 1].text
              : '';

          if (clean && !(prevText && clean === prevText && clean.length >= 6)) {
            recognizedSegments.push({
              id: `seg-${idx}-${Math.round(seg.startSec * 100)}`,
              startSec: Number(seg.startSec.toFixed(2)),
              endSec: Number(seg.endSec.toFixed(2)),
              text: clean,
            });
          }
        }

        const pct =
          idx === totalSegments - 1
            ? 100
            : Math.min(99, Math.max(5, Math.round(((idx + 1) / totalSegments) * 100)));

        self.postMessage({
          type: 'transcribe-progress',
          taskId: msg.taskId,
          progress: pct,
          segmentIndex: idx + 1,
          totalSegments,
          liveText: '',
          segments: recognizedSegments,
          detectedLanguage: langCode,
        } satisfies SpeechWorkerOutgoing);
      }

      const finalFullText = recognizedSegments.map((s) => s.text).join('\n');
      self.postMessage({
        type: 'transcribe-result',
        taskId: msg.taskId,
        text: finalFullText,
        segments: recognizedSegments,
        deviceUsed,
        detectedLanguage: langCode,
      } satisfies SpeechWorkerOutgoing);
    } catch (err) {
      self.postMessage({
        type: 'transcribe-error',
        taskId: msg.taskId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SpeechWorkerOutgoing);
    }
  }
};
