export type WhisperModelId =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-small'
  | 'onnx-community/whisper-large-v3-turbo';

export interface ModelOption {
  id: WhisperModelId;
  name: string;
  sizeLabel: string;
  approxBytes: number;
  speedLabel: string;
  accuracyLabel: string;
  description: string;
  recommended?: boolean;
  dtypeConfig: {
    encoder_model: string;
    decoder_model_merged: string;
  };
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'Xenova/whisper-tiny',
    name: 'Whisper Tiny',
    sizeLabel: '~45 MB',
    approxBytes: 45 * 1024 * 1024,
    speedLabel: '极速',
    accuracyLabel: '基础',
    description: '体积最小、加载最快，适合语音清晰的单人访谈或低内存设备。',
    dtypeConfig: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
  },
  {
    id: 'Xenova/whisper-base',
    name: 'Whisper Base',
    sizeLabel: '~85 MB',
    approxBytes: 85 * 1024 * 1024,
    speedLabel: '快速',
    accuracyLabel: '均衡',
    description: '速度与中文识别准确度的最佳平衡点，推荐作为日常批量处理默认模型。',
    recommended: true,
    dtypeConfig: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
  },
  {
    id: 'Xenova/whisper-small',
    name: 'Whisper Small',
    sizeLabel: '~255 MB',
    approxBytes: 255 * 1024 * 1024,
    speedLabel: '适中',
    accuracyLabel: '高精度',
    description: '对中英混杂、专业术语及轻度背景噪音的视频有明显更好的识别效果。',
    dtypeConfig: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
  },
  {
    id: 'onnx-community/whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    sizeLabel: '~800 MB',
    approxBytes: 800 * 1024 * 1024,
    speedLabel: '需 WebGPU',
    accuracyLabel: '旗舰级',
    description: '最高精度的多语种大模型，建议在支持 WebGPU 的独立显卡电脑上使用。',
    dtypeConfig: {
      encoder_model: 'q8',
      decoder_model_merged: 'q8',
    },
  },
];

export type InferenceDevice = 'auto' | 'webgpu' | 'wasm';
export type TranscriptionTask = 'transcribe' | 'translate';

export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'auto', label: '自动检测语言' },
  { code: 'chinese', label: '中文 (普通话 / 粤语)' },
  { code: 'english', label: 'English (英语)' },
  { code: 'japanese', label: '日本語 (日语)' },
  { code: 'korean', label: '한국어 (韩语)' },
  { code: 'french', label: 'Français (法语)' },
  { code: 'german', label: 'Deutsch (德语)' },
  { code: 'spanish', label: 'Español (西班牙语)' },
];

export interface SubtitleChunk {
  id: string;
  start: number;
  end: number;
  text: string;
}

export type QueueItemStatus =
  | 'queued'
  | 'decoding'
  | 'transcribing'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface MediaQueueItem {
  id: string;
  file?: File;
  objectUrl?: string;
  fileName: string;
  fileSize: number;
  fileType: 'audio' | 'video';
  mimeType: string;
  duration: number;
  status: QueueItemStatus;
  progress: number;
  stageText: string;
  streamingText?: string;
  errorMessage?: string;
  chunks: SubtitleChunk[];
  fullText: string;
  modelUsed?: string;
  languageUsed?: string;
  createdAt: number;
  completedAt?: number;
  elapsedMs?: number;
  selectedForExport: boolean;
  isHistoryOnly?: boolean;
}

export interface ExportSettings {
  srtIncludeBom: boolean;
  srtMaxLineChars: number;
  txtMode: 'continuous' | 'lines' | 'timestamped';
  txtIncludeTitle: boolean;
}

export interface EngineConfig {
  modelId: WhisperModelId;
  device: InferenceDevice;
  language: string;
  task: TranscriptionTask;
  remoteHost: string;
  offlineOnly: boolean;
  localModelLoadedName: string | null;
}

export interface ModelCacheStatus {
  modelId: string;
  cached: boolean;
  cachedBytes: number;
  fileCount: number;
}

export interface ModelDownloadProgress {
  modelId: string;
  status: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  currentFile: string;
  error?: string;
}

export type ActiveNavTab = 'workspace' | 'models' | 'formats' | 'privacy';
