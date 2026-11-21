export type WhisperModelId =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-small';

export type ModelDtypeMap = {
  encoder_model: 'q8' | 'fp32' | 'fp16' | 'q4';
  decoder_model_merged: 'q8' | 'fp32' | 'fp16' | 'q4';
};

export interface ModelOption {
  id: WhisperModelId;
  name: string;
  sizeLabel: string;
  approxBytes: number;
  speedLabel: string;
  accuracyLabel: string;
  description: string;
  recommended?: boolean;
  wasmDtype: ModelDtypeMap;
  webgpuDtype: ModelDtypeMap;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'Xenova/whisper-tiny',
    name: 'Whisper Tiny',
    sizeLabel: '~45 MB',
    approxBytes: 45 * 1024 * 1024,
    speedLabel: '极速',
    accuracyLabel: '基础',
    description: '体积最小、下载和启动最快，适合声音清晰的语音备忘与快速测试。',
    wasmDtype: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
    webgpuDtype: {
      encoder_model: 'fp32',
      decoder_model_merged: 'fp32',
    },
  },
  {
    id: 'Xenova/whisper-base',
    name: 'Whisper Base',
    sizeLabel: '~85 MB',
    approxBytes: 85 * 1024 * 1024,
    speedLabel: '较快',
    accuracyLabel: '均衡',
    description: '速度与中文标点准确率平衡良好，推荐作为日常语音转文字默认模型。',
    recommended: true,
    wasmDtype: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
    webgpuDtype: {
      encoder_model: 'fp32',
      decoder_model_merged: 'fp32',
    },
  },
  {
    id: 'Xenova/whisper-small',
    name: 'Whisper Small',
    sizeLabel: '~255 MB',
    approxBytes: 255 * 1024 * 1024,
    speedLabel: '适中',
    accuracyLabel: '高精度',
    description: '适合中英混杂、专业术语较多或带轻度背景噪音的录音与视频。',
    wasmDtype: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
    webgpuDtype: {
      encoder_model: 'fp32',
      decoder_model_merged: 'fp32',
    },
  },
];

export type DownloadSource = 'huggingface' | 'hf-mirror' | 'auto-fallback' | 'custom';

export const DOWNLOAD_SOURCE_HOSTS: Record<string, string> = {
  huggingface: 'https://huggingface.co/',
  'hf-mirror': 'https://hf-mirror.com/',
  'auto-fallback': 'https://hf-mirror.com/',
};

export type InferenceDevice = 'auto' | 'webgpu' | 'wasm';

export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'zh-hans', label: '简体中文（推荐 · 自动繁转简）' },
  { code: 'zh-hant', label: '繁體中文' },
  { code: 'chinese', label: '中文（模型原样输出）' },
  { code: 'auto', label: '自动检测语言（中文转简体）' },
  { code: 'english', label: 'English（英语）' },
  { code: 'japanese', label: '日本語（日语）' },
  { code: 'korean', label: '한국어（韩语）' },
  { code: 'french', label: 'Français（法语）' },
  { code: 'german', label: 'Deutsch（德语）' },
  { code: 'spanish', label: 'Español（西班牙语）' },
];

export interface SpeechConfig {
  modelId: WhisperModelId;
  device: InferenceDevice;
  language: string;
  downloadSource: DownloadSource;
  customMirrorUrl: string;
  offlineOnly: boolean;
  localModelName: string | null;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface AudioSegmentBound {
  startSample: number;
  endSample: number;
  startSec: number;
  endSec: number;
  isSilent: boolean;
}

export type PipelineStep = 'idle' | 'decoding' | 'loading-model' | 'transcribing' | 'done' | 'error';

export type JobStatus = 'ready' | 'processing' | 'completed' | 'error' | 'cancelled' | 'interrupted';

export interface TranscriptJob {
  id: string;
  file?: File;
  objectUrl?: string;
  fileName: string;
  fileSize: number;
  mediaKind: 'audio' | 'video';
  duration: number;
  status: JobStatus;
  step: PipelineStep;
  progress: number;
  statusText: string;
  liveText: string;
  segments: TranscriptSegment[];
  fullText: string;
  elapsedMs?: number;
  elapsedMsSoFar?: number;
  deviceUsed?: 'webgpu' | 'wasm';
  detectedLanguage?: string;
  modelUsed?: string;
  errorDetail?: string;
  createdAt: number;
  completedAt?: number;
  isHistoryOnly?: boolean;
  hasCheckpoint?: boolean;
  checkpointDoneSegments?: number;
  checkpointTotalSegments?: number;
  checkpointModelId?: WhisperModelId;
  checkpointLanguage?: string;
}

export interface ModelCacheInfo {
  modelId: string;
  cached: boolean;
  cachedBytes: number;
  fileCount: number;
}

export interface ModelDownloadState {
  modelId: string;
  status: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  currentFile: string;
  error?: string;
}

export type ActiveTab = 'workspace' | 'models' | 'guide';
