import {
  AutomaticSpeechRecognitionPipeline,
  WhisperTextStreamer,
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
    }
  | {
      type: 'transcribe-result';
      taskId: string;
      text: string;
      chunks: Array<{ timestamp: [number | null, number | null]; text: string }>;
      deviceUsed: 'webgpu' | 'wasm';
    }
  | {
      type: 'transcribe-error';
      taskId: string;
      error: string;
    };

const LOCAL_MODEL_VIRTUAL_ID = 'local-disk/whisper-custom';
const originalFetch = self.fetch.bind(self);
const localFilesMap = new Map<string, File>();

function configureBaseEnvironment(remoteHost: string, offlineOnly: boolean, useLocalFolder: boolean) {
  env.useBrowserCache = true;
  env.cacheKey = 'transformers-cache';
  env.allowLocalModels = false;
  env.allowRemoteModels = useLocalFolder ? true : !offlineOnly;

  if (remoteHost && remoteHost.trim()) {
    const normalized = remoteHost.trim().endsWith('/') ? remoteHost.trim() : `${remoteHost.trim()}/`;
    env.remoteHost = normalized;
  }

  // Point ONNX Runtime WASM binaries to our self-hosted local /ort/ assets
  if (env.backends.onnx?.wasm) {
    const origin = self.location.origin;
    env.backends.onnx.wasm.wasmPaths = {
      mjs: `${origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
    };
  }

  // Intercept fetch when using an air-gapped local model folder from disk
  if (useLocalFolder && localFilesMap.size > 0) {
    env.fetch = async (input: string | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.includes(LOCAL_MODEL_VIRTUAL_ID)) {
        // Extract relative path after /resolve/main/ or model id
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

let activePipeline: AutomaticSpeechRecognitionPipeline | null = null;
let activePipelineKey = '';
let activeDeviceUsed: 'webgpu' | 'wasm' = 'wasm';

async function getOrCreatePipeline(
  modelId: string,
  requestedDevice: 'auto' | 'webgpu' | 'wasm',
  remoteHost: string,
  offlineOnly: boolean,
  useLocalFolder: boolean
): Promise<{ pipe: AutomaticSpeechRecognitionPipeline; deviceUsed: 'webgpu' | 'wasm' }> {
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
  const dtype = modelOption?.dtypeConfig ?? {
    encoder_model: 'q8',
    decoder_model_merged: 'q8',
  };

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipe = await (pipeline as any)('automatic-speech-recognition', effectiveModelId, {
      device: dev,
      dtype: dtype as Record<string, 'q8' | 'fp32' | 'fp16' | 'q4'>,
      local_files_only: useLocalFolder ? false : offlineOnly,
      progress_callback,
    });
    return pipe as AutomaticSpeechRecognitionPipeline;
  };

  try {
    activePipeline = await loadWithDevice(targetDevice);
    activeDeviceUsed = targetDevice;
    activePipelineKey = key;
  } catch (err) {
    if (targetDevice === 'webgpu') {
      // Automatic fallback to WASM if WebGPU adapter/shader compilation fails
      activePipeline = await loadWithDevice('wasm');
      activeDeviceUsed = 'wasm';
      activePipelineKey = `${effectiveModelId}::wasm::${remoteHost}::${offlineOnly}::${useLocalFolder ? localFilesMap.size : 0}`;
    } else {
      throw err;
    }
  }

  return { pipe: activePipeline, deviceUsed: activeDeviceUsed };
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
      // Strip top-level folder prefix if user picked a folder like "whisper-base/config.json"
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
      const chunkLengthS = 30;
      const strideLengthS = 5;
      const windowSamples = samplingRate * chunkLengthS;
      const strideSamples = samplingRate * strideLengthS;
      const jumpSamples = windowSamples - 2 * strideSamples;

      // Estimate exact total chunks matching Whisper's _call_whisper chunking loop
      let estimatedChunks = 1;
      if (msg.audioData.length > windowSamples) {
        let offset = 0;
        estimatedChunks = 0;
        while (true) {
          estimatedChunks++;
          if (offset + windowSamples >= msg.audioData.length) break;
          offset += jumpSamples;
        }
      }

      let currentChunk = 0;
      let streamingBuffer = '';
      let lastPostTime = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenizer = (pipe as any).tokenizer;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processor = (pipe as any).processor;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (pipe as any).model;

      const chunkLength = processor?.feature_extractor?.config?.chunk_length ?? 30;
      const maxSourcePos = model?.config?.max_source_positions ?? 1500;
      const timePrecision = chunkLength / maxSourcePos;

      const streamer = tokenizer
        ? new WhisperTextStreamer(tokenizer, {
            time_precision: timePrecision,
            skip_prompt: true,
            skip_special_tokens: true,
            on_chunk_start: () => {
              currentChunk = Math.min(estimatedChunks, currentChunk + 1);
            },
            callback_function: (textPiece: string) => {
              streamingBuffer += textPiece;
              const now = performance.now();
              if (now - lastPostTime > 120) {
                lastPostTime = now;
                const basePct = ((Math.max(0, currentChunk - 1)) / estimatedChunks) * 100;
                const pct = Math.min(98, Math.max(2, Math.round(basePct + 100 / estimatedChunks / 2)));
                self.postMessage({
                  type: 'transcribe-progress',
                  taskId: msg.taskId,
                  progress: pct,
                  chunkIndex: Math.max(1, currentChunk),
                  totalChunks: estimatedChunks,
                  streamingText: streamingBuffer.slice(-300),
                } satisfies WorkerOutgoingMessage);
              }
            },
            on_chunk_end: () => {
              const pct = Math.min(99, Math.round((currentChunk / estimatedChunks) * 100));
              self.postMessage({
                type: 'transcribe-progress',
                taskId: msg.taskId,
                progress: pct,
                chunkIndex: currentChunk,
                totalChunks: estimatedChunks,
                streamingText: streamingBuffer.slice(-300),
              } satisfies WorkerOutgoingMessage);
            },
          })
        : undefined;

      const callOptions: Record<string, unknown> = {
        chunk_length_s: chunkLengthS,
        stride_length_s: strideLengthS,
        return_timestamps: true,
        task: msg.task,
        return_language: true,
        suppress_tokens: [],
      };

      if (msg.language && msg.language !== 'auto') {
        callOptions.language = msg.language;
      }
      if (streamer) {
        callOptions.streamer = streamer;
      }

      const output = await pipe(msg.audioData, callOptions);
      const single = Array.isArray(output) ? output[0] : output;

      // Ensure progress hits 100% and finishes cleanly
      self.postMessage({
        type: 'transcribe-progress',
        taskId: msg.taskId,
        progress: 100,
        chunkIndex: estimatedChunks,
        totalChunks: estimatedChunks,
        streamingText: (single?.text || '').slice(-300),
      } satisfies WorkerOutgoingMessage);

      self.postMessage({
        type: 'transcribe-result',
        taskId: msg.taskId,
        text: (single?.text || '').trim(),
        chunks: (single?.chunks || []) as Array<{
          timestamp: [number | null, number | null];
          text: string;
        }>,
        deviceUsed,
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
