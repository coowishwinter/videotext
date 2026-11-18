import {
  StoppingCriteria,
  StoppingCriteriaList,
  env,
  pipeline,
} from '@huggingface/transformers';
import { MODEL_OPTIONS } from '../types/transcribe';

export interface WorkerLocalFileEntry {
  relativePath: string;
  file: File;
}

export type WorkerIncomingMessage =
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
      task: 'transcribe' | 'translate';
      remoteHost: string;
      offlineOnly: boolean;
      useLocalFolderModel: boolean;
    };

export type WorkerOutgoingMessage =
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
      chunkIndex: number;
      totalChunks: number;
      streamingText: string;
      partialChunks?: Array<{ timestamp: [number | null, number | null]; text: string }>;
      detectedLanguage?: string;
    }
  | {
      type: 'transcribe-result';
      taskId: string;
      text: string;
      chunks: Array<{ timestamp: [number | null, number | null]; text: string }>;
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

/**
 * Custom StoppingCriteria that immediately breaks out of Whisper's autoregressive loop
 * if consecutive repeating token/phrase hallucinations occur, and emits throttled
 * token-step heartbeats so the UI never appears frozen on long segments.
 */
class AntiRepetitionStoppingCriteria extends StoppingCriteria {
  private prefixLen: number;
  private noTimestampsTokenId: number;
  private lastTickTime = 0;
  private onTick?: (generatedCount: number) => void;
  public loopDetected = false;
  public cleanCutoffIndex: number | null = null;

  constructor(
    prefixLen: number,
    noTimestampsTokenId: number,
    onTick?: (generatedCount: number) => void
  ) {
    super();
    this.prefixLen = prefixLen;
    this.noTimestampsTokenId = noTimestampsTokenId;
    this.onTick = onTick;
  }

  _call(input_ids: number[][]): boolean[] {
    const row = input_ids[0] as unknown as Array<number | bigint> | undefined;
    if (!row || row.length <= this.prefixLen) {
      return [false];
    }

    const generated = row.slice(this.prefixLen).map(Number);
    const now = performance.now();
    if (this.onTick && now - this.lastTickTime > 500) {
      this.lastTickTime = now;
      this.onTick(generated.length);
    }

    // Extract non-special / non-timestamp text tokens along with their positions in `generated`
    const textTokens: number[] = [];
    const textPositions: number[] = [];
    for (let i = 0; i < generated.length; i++) {
      const tok = generated[i];
      if (tok < this.noTimestampsTokenId) {
        textTokens.push(tok);
        textPositions.push(i);
      }
    }

    const len = textTokens.length;
    if (len < 6) return [false];

    // 1) Detect single token repeated 6+ times consecutively
    const lastTok = textTokens[len - 1];
    let sameCount = 1;
    for (let i = len - 2; i >= 0 && textTokens[i] === lastTok; i--) {
      sameCount++;
    }
    if (sameCount >= 6) {
      this.loopDetected = true;
      this.cleanCutoffIndex = textPositions[len - sameCount + 1];
      return [true];
    }

    // 2) Detect repeating phrase loop of length n (e.g. A B C D | A B C D)
    const maxPatternLen = Math.min(24, Math.floor(len / 2));
    for (let n = 2; n <= maxPatternLen; n++) {
      // For very short patterns (n=2..3), require 3 consecutive repeats; for n>=4, 2 repeats
      const requiredRepeats = n <= 3 ? 3 : 2;
      if (len < n * requiredRepeats) continue;

      let matched = true;
      for (let r = 1; r < requiredRepeats && matched; r++) {
        const startA = len - n * (r + 1);
        const startB = len - n * r;
        for (let k = 0; k < n; k++) {
          if (textTokens[startA + k] !== textTokens[startB + k]) {
            matched = false;
            break;
          }
        }
      }

      if (matched) {
        this.loopDetected = true;
        // Keep the first occurrence and cut off all repeated copies
        const keepUpToTextIdx = len - n * (requiredRepeats - 1);
        this.cleanCutoffIndex = textPositions[Math.max(0, keepUpToTextIdx)];
        return [true];
      }
    }

    return [false];
  }
}

function configureBaseEnvironment(remoteHost: string, offlineOnly: boolean, useLocalFolder: boolean) {
  env.useBrowserCache = true;
  env.cacheKey = 'transformers-cache';
  env.allowLocalModels = false;
  env.allowRemoteModels = useLocalFolder ? true : !offlineOnly;

  if (remoteHost && remoteHost.trim()) {
    const normalized = remoteHost.trim().endsWith('/') ? remoteHost.trim() : `${remoteHost.trim()}/`;
    env.remoteHost = normalized;
  }

  if (env.backends.onnx?.wasm) {
    const origin = self.location.origin;
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
    };
  }

  if (useLocalFolder && localFilesMap.size > 0) {
    env.fetch = async (input: string | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.includes(LOCAL_MODEL_VIRTUAL_ID)) {
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
      return originalFetch(input, init);
    };
  } else {
    env.fetch = originalFetch;
  }
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
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
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
  const effectiveModelId = useLocalFolder && localFilesMap.size > 0 ? LOCAL_MODEL_VIRTUAL_ID : modelId;
  configureBaseEnvironment(remoteHost, offlineOnly, useLocalFolder && localFilesMap.size > 0);

  let targetDevice: 'webgpu' | 'wasm' = 'wasm';
  if (requestedDevice === 'webgpu') {
    targetDevice = 'webgpu';
  } else if (requestedDevice === 'auto') {
    const hasGpu = await detectWebGpuSupport();
    targetDevice = hasGpu ? 'webgpu' : 'wasm';
  }

  const key = `${effectiveModelId}::${targetDevice}::${remoteHost}::${offlineOnly}::${useLocalFolder ? localFilesMap.size : 0}`;
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
      sumTotal > 0 ? Math.min(99, Math.round((sumLoaded / sumTotal) * 100)) : Math.round(info.progress ?? 0);

    self.postMessage({
      type: 'model-progress',
      modelId,
      status: (info.status as 'initiate' | 'download' | 'progress' | 'done' | 'ready') || 'progress',
      file,
      progress: info.status === 'ready' ? 100 : overallProgress,
      loaded: sumLoaded,
      total: sumTotal,
    } satisfies WorkerOutgoingMessage);
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
      local_files_only: useLocalFolder ? false : offlineOnly,
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
      activePipelineKey = `${effectiveModelId}::wasm::${remoteHost}::${offlineOnly}::${useLocalFolder ? localFilesMap.size : 0}`;
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

/**
 * Splits 16kHz mono audio into <=28s segments along silence valleys, avoiding tiny <4s
 * trailing stubs that trigger Whisper zero-padding hallucination loops.
 */
function splitAudioIntoSmartSegments(audio: Float32Array, sampleRate = 16000): AudioSegment[] {
  const maxSamples = Math.floor(28 * sampleRate);
  const minSplitSamples = Math.floor(15 * sampleRate);
  const minTailSamples = Math.floor(4 * sampleRate);
  const frameSamples = Math.floor(0.1 * sampleRate);
  const silenceRmsThreshold = 0.0025;

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

    // If remaining is slightly over maxSamples (e.g. 28s..33s), split evenly in half
    // so the final segment isn't a tiny zero-padded stub
    let searchStart = cursor + minSplitSamples;
    let searchEnd = cursor + maxSamples;
    if (remaining < maxSamples + minTailSamples) {
      const mid = cursor + Math.floor(remaining / 2);
      searchStart = Math.max(cursor + Math.floor(8 * sampleRate), mid - 3 * sampleRate);
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

const LANGUAGE_NAME_TO_SHORT: Record<string, string> = {
  chinese: 'zh',
  english: 'en',
  japanese: 'ja',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  spanish: 'es',
};

// Punctuation-only / neutral prompts prevent Tiny/Base models from echoing prompt words
const PUNCTUATION_PROMPTS: Record<string, string> = {
  zh: '，。？！',
  en: ', . ? !',
  ja: '、。？！',
  ko: ', . ? !',
  fr: ', . ? !',
  de: ', . ? !',
  es: ', . ? !',
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

    const sotId = genConfig.decoder_start_token_id;
    const slice = sampleAudio.subarray(0, Math.min(sampleAudio.length, 16000 * 15));
    const feat = await processor(slice);
    const out = await model.generate({
      inputs: feat.input_features,
      decoder_input_ids: [sotId],
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
    // fallback safely
  }
  return 'zh';
}

/**
 * Collapses accidental consecutive phrase repeats inside a decoded string.
 */
function stripTrailingTextRepetition(text: string): string {
  const clean = text.trim();
  if (!clean) return '';
  // Collapse exact sentence/clause repeats appearing 2+ times consecutively
  return clean.replace(/(.{4,40}?)\1{1,}/g, '$1').trim();
}

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const msg = event.data;

  if (msg.type === 'detect-capabilities') {
    const webgpuSupported = await detectWebGpuSupport();
    self.postMessage({
      type: 'capabilities',
      webgpuSupported,
    } satisfies WorkerOutgoingMessage);
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
    } satisfies WorkerOutgoingMessage);
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
      } satisfies WorkerOutgoingMessage);
    } catch (err) {
      self.postMessage({
        type: 'model-error',
        modelId: msg.modelId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutgoingMessage);
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      const { pipe, deviceUsed } = await getOrCreatePipeline(
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
      } satisfies WorkerOutgoingMessage);

      const samplingRate = 16000;
      const segments = splitAudioIntoSmartSegments(msg.audioData, samplingRate);
      const totalSegments = segments.length;

      const processor = pipe.processor;
      const model = pipe.model;
      const tokenizer = pipe.tokenizer;
      const genConfig = model.generation_config;

      const chunkLength = processor?.feature_extractor?.config?.chunk_length ?? 30;
      const hopLength = processor?.feature_extractor?.config?.hop_length ?? 160;
      const maxSourcePos = model?.config?.max_source_positions ?? 1500;
      const timePrecision = chunkLength / maxSourcePos;
      const noTimestampsTokenId = Number(
        genConfig?.no_timestamps_token_id ?? tokenizer?._tokenizer?.token_to_id?.('<|notimestamps|>') ?? 50363
      );

      let langCode = LANGUAGE_NAME_TO_SHORT[msg.language] ?? msg.language;
      if (!msg.language || msg.language === 'auto') {
        const firstActive = segments.find((s) => !s.isSilent) ?? segments[0];
        const sampleSlice = msg.audioData.subarray(firstActive.startSample, firstActive.endSample);
        langCode = await detectLanguageCode(pipe, sampleSlice);
      }

      const isMultilingual = Boolean(genConfig?.is_multilingual);
      const sotId = Number(genConfig?.decoder_start_token_id ?? 50258);
      const taskId = Number(genConfig?.task_to_id?.[msg.task] ?? 50359);
      const langTokenId = genConfig?.lang_to_id?.[`<|${langCode}|>`];

      const baseInitTokens: number[] =
        isMultilingual && langTokenId != null ? [sotId, Number(langTokenId), taskId] : [sotId];

      let decoderInputIds: number[] = baseInitTokens;
      try {
        const startOfPrevId = tokenizer?._tokenizer?.token_to_id?.('<|startofprev|>');
        const promptText = PUNCTUATION_PROMPTS[langCode] ?? PUNCTUATION_PROMPTS.en;
        if (typeof startOfPrevId === 'number' && startOfPrevId >= 0 && tokenizer?.encode) {
          const promptTokens: number[] = tokenizer
            .encode(promptText, { add_special_tokens: false })
            .map(Number);
          if (promptTokens.length > 0 && promptTokens.length < 32) {
            decoderInputIds = [startOfPrevId, ...promptTokens, ...baseInitTokens];
          }
        }
      } catch {
        decoderInputIds = baseInitTokens;
      }

      const accumulatedChunks: Array<{ timestamp: [number | null, number | null]; text: string }> = [];
      let accumulatedText = '';

      for (let idx = 0; idx < totalSegments; idx++) {
        const seg = segments[idx];
        const segDuration = (seg.endSample - seg.startSample) / samplingRate;

        if (!seg.isSilent && segDuration >= 0.25) {
          const segAudio = msg.audioData.subarray(seg.startSample, seg.endSample);
          const feature = await processor(segAudio);
          const numFrames = Math.floor(segAudio.length / hopLength);

          // Scale max_new_tokens strictly to segment duration to prevent long silence hallucinations
          const maxNewTokens = Math.min(280, Math.max(36, Math.ceil(segDuration * 12) + 16));

          const stoppingList = new StoppingCriteriaList();
          const antiLoop = new AntiRepetitionStoppingCriteria(
            decoderInputIds.length,
            noTimestampsTokenId,
            (tokenCount) => {
              const basePct = Math.round((idx / totalSegments) * 100);
              const segSlicePct = Math.min(99, basePct + Math.round((1 / totalSegments) * 50));
              self.postMessage({
                type: 'transcribe-progress',
                taskId: msg.taskId,
                progress: Math.min(99, Math.max(2, segSlicePct)),
                chunkIndex: idx + 1,
                totalChunks: totalSegments,
                streamingText: `正在识别第 ${idx + 1}/${totalSegments} 段（已生成 ${tokenCount} 个词元）...`,
                detectedLanguage: langCode,
              } satisfies WorkerOutgoingMessage);
            }
          );
          stoppingList.push(antiLoop);

          const outputTensor = await model.generate({
            inputs: feature.input_features,
            decoder_input_ids: decoderInputIds,
            max_new_tokens: maxNewTokens,
            return_timestamps: true,
            num_frames: numFrames,
            no_repeat_ngram_size: 6,
            repetition_penalty: 1.12,
            stopping_criteria: stoppingList,
          });

          const rawSeq = outputTensor[0].tolist().map(Number);
          let generatedOnly = rawSeq.slice(decoderInputIds.length);
          if (antiLoop.loopDetected && antiLoop.cleanCutoffIndex !== null) {
            generatedOnly = generatedOnly.slice(0, Math.max(1, antiLoop.cleanCutoffIndex));
          }

          if (generatedOnly.length > 0) {
            const [segText, optional] = tokenizer._decode_asr(
              [
                {
                  tokens: generatedOnly,
                  stride: [segDuration, 0, 0],
                },
              ],
              {
                time_precision: timePrecision,
                return_timestamps: true,
                force_full_sequences: false,
              }
            );

            const segChunks: Array<{ timestamp: [number | null, number | null]; text: string }> =
              optional?.chunks ?? [];

            if (segChunks.length > 0) {
              for (const ch of segChunks) {
                const text = stripTrailingTextRepetition(ch.text || '');
                if (!text) continue;
                const prevText =
                  accumulatedChunks.length > 0
                    ? accumulatedChunks[accumulatedChunks.length - 1].text
                    : '';
                // Skip exact duplicate hallucination if repeated from previous chunk
                if (prevText && text === prevText && text.length >= 6) continue;

                const localStart = ch.timestamp?.[0] ?? 0;
                const localEnd = ch.timestamp?.[1];
                const absStart = Math.max(seg.startSec, seg.startSec + localStart);
                const absEnd =
                  typeof localEnd === 'number' && Number.isFinite(localEnd)
                    ? Math.min(seg.endSec, seg.startSec + localEnd)
                    : seg.endSec;

                accumulatedChunks.push({
                  timestamp: [
                    Number(absStart.toFixed(2)),
                    Number(Math.max(absStart + 0.2, absEnd).toFixed(2)),
                  ],
                  text,
                });
              }
              accumulatedText = accumulatedChunks.map((c) => c.text).join(' ').trim();
            } else if (segText && segText.trim()) {
              const clean = stripTrailingTextRepetition(segText);
              const prevText =
                accumulatedChunks.length > 0
                  ? accumulatedChunks[accumulatedChunks.length - 1].text
                  : '';
              if (clean && !(prevText && clean === prevText && clean.length >= 6)) {
                accumulatedChunks.push({
                  timestamp: [Number(seg.startSec.toFixed(2)), Number(seg.endSec.toFixed(2))],
                  text: clean,
                });
                accumulatedText = accumulatedChunks.map((c) => c.text).join(' ').trim();
              }
            }
          }
        }

        const pct = Math.min(99, Math.max(5, Math.round(((idx + 1) / totalSegments) * 100)));
        self.postMessage({
          type: 'transcribe-progress',
          taskId: msg.taskId,
          progress: idx === totalSegments - 1 ? 100 : pct,
          chunkIndex: idx + 1,
          totalChunks: totalSegments,
          streamingText: accumulatedText.slice(-300),
          partialChunks: accumulatedChunks,
          detectedLanguage: langCode,
        } satisfies WorkerOutgoingMessage);
      }

      self.postMessage({
        type: 'transcribe-result',
        taskId: msg.taskId,
        text: accumulatedText,
        chunks: accumulatedChunks,
        deviceUsed,
        detectedLanguage: langCode,
      } satisfies WorkerOutgoingMessage);
    } catch (err) {
      self.postMessage({
        type: 'transcribe-error',
        taskId: msg.taskId,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutgoingMessage);
    }
  }
};
