import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigSidebar } from './components/ConfigSidebar';
import { GuideView } from './components/GuideView';
import { ModelsView } from './components/ModelsView';
import { SpeechWorkspace } from './components/SpeechWorkspace';
import { TopBar } from './components/TopBar';
import {
  ActiveTab,
  DOWNLOAD_SOURCE_HOSTS,
  ModelCacheInfo,
  ModelDownloadState,
  SpeechConfig,
  TranscriptJob,
  TranscriptSegment,
  WhisperModelId,
} from './types/speech';
import {
  decodeMediaTo16kMono,
  detectMediaKind,
  isSupportedMediaFile,
  probeMediaDurationFromUrl,
} from './utils/audioDecoder';
import {
  clearModelCache,
  deleteCheckpointFromDB,
  deleteTranscriptFromDB,
  inspectModelCaches,
  loadCheckpointAudioData,
  loadCheckpointsFromDB,
  loadTranscriptsFromDB,
  saveCheckpointAudioAndMeta,
  saveTranscriptToDB,
  updateCheckpointProgress,
  updateCheckpointStartMeta,
} from './utils/storage';
import {
  convertToSimplifiedChinese,
  downloadTxtFile,
  formatSegmentsText,
  getBaseFileName,
} from './utils/textFormatter';
import type { SpeechWorkerOutgoing, WorkerLocalFileEntry } from './workers/speechWorker';

const DEFAULT_CONFIG: SpeechConfig = {
  modelId: 'Xenova/whisper-base',
  device: 'auto',
  language: 'zh-hans',
  downloadSource: 'auto-fallback',
  customMirrorUrl: 'https://hf-mirror.com/',
  offlineOnly: false,
  localModelName: null,
};

const STORAGE_CONFIG_KEY = 'shengji_stt_config_v2';
const STORAGE_THEME_KEY = 'shengji_theme_v1';

function resolveRemoteHost(cfg: SpeechConfig): string {
  if (cfg.downloadSource === 'hf-mirror') return DOWNLOAD_SOURCE_HOSTS['hf-mirror'];
  if (cfg.downloadSource === 'custom' && cfg.customMirrorUrl.trim()) {
    return cfg.customMirrorUrl.trim();
  }
  return DOWNLOAD_SOURCE_HOSTS.huggingface;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [config, setConfig] = useState<SpeechConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (saved) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved), localModelName: null };
      }
    } catch {
      // ignore
    }
    return DEFAULT_CONFIG;
  });

  const [jobs, setJobs] = useState<TranscriptJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);
  const [activeDeviceUsed, setActiveDeviceUsed] = useState<'webgpu' | 'wasm' | null>(null);
  const [cacheMap, setCacheMap] = useState<Record<string, ModelCacheInfo>>({});
  const [downloadState, setDownloadState] = useState<ModelDownloadState>({
    modelId: DEFAULT_CONFIG.modelId,
    status: 'idle',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    currentFile: '',
  });
  const [banner, setBanner] = useState<{ type: 'info' | 'error'; message: string } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const stopRequestedRef = useRef(false);
  const jobsRef = useRef<TranscriptJob[]>([]);
  const configRef = useRef<SpeechConfig>(config);
  const localModelFilesRef = useRef<{ name: string; files: WorkerLocalFileEntry[] } | null>(null);
  const globalFilePickerRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const activeTaskTimingRef = useRef<{
    jobId: string;
    startedAt: number;
    baseElapsedMs: number;
  } | null>(null);
  const checkpointSaveChainRef = useRef<Promise<void>>(Promise.resolve());

  // 1. 禁止刷新/关闭页面提示 (Prevent refresh or tab close during processing)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = '正在进行本地语音转文字，关闭或刷新页面将中断转写（已保存断点进度，重开可继续）。确定要离开吗？';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isProcessing]);

  // 2. 保持浏览器活跃 (Keep browser active via Screen Wake Lock API, re-acquire on visibility return)
  useEffect(() => {
    let cancelled = false;

    const requestLock = () => {
      if (!isProcessing || cancelled) return;
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        nav.wakeLock
          ?.request('screen')
          .then((lock) => {
            if (cancelled) {
              lock.release().catch(() => {});
              return;
            }
            wakeLockRef.current = lock;
          })
          .catch(() => {
            // Wake lock denied or unsupported
          });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isProcessing && !wakeLockRef.current) {
        requestLock();
      }
    };

    if (isProcessing) {
      requestLock();
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } else if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [isProcessing]);

  const pendingTasksRef = useRef<
    Map<
      string,
      {
        resolve: (val: {
          text: string;
          segments: TranscriptSegment[];
          deviceUsed: 'webgpu' | 'wasm';
          detectedLanguage?: string;
        }) => void;
        reject: (err: Error) => void;
      }
    >
  >(new Map());

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    configRef.current = config;
    try {
      const { localModelName: _ignored, ...persistable } = config;
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(persistable));
    } catch {
      // ignore
    }
  }, [config]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const refreshCacheStatus = useCallback(async () => {
    const map = await inspectModelCaches();
    setCacheMap(map);
  }, []);

  const initWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = new Worker(new URL('./workers/speechWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<SpeechWorkerOutgoing>) => {
      const msg = event.data;

      if (msg.type === 'capabilities') {
        setWebgpuSupported(msg.webgpuSupported);
        return;
      }

      if (msg.type === 'local-model-registered') {
        setBanner({
          type: 'info',
          message: `已挂载本地模型目录「${msg.modelName}」（共 ${msg.fileCount} 个文件），可离线直接识别。`,
        });
        return;
      }

      if (msg.type === 'model-progress') {
        setDownloadState({
          modelId: msg.modelId,
          status: msg.status === 'ready' ? 'ready' : 'downloading',
          progress: msg.progress,
          loadedBytes: msg.loaded,
          totalBytes: msg.total,
          currentFile: msg.file,
        });

        setJobs((prev) =>
          prev.map((j) =>
            j.status === 'processing' && j.step === 'loading-model'
              ? {
                  ...j,
                  progress: Math.max(8, Math.min(28, 8 + Math.round(msg.progress * 0.2))),
                  statusText: msg.file
                    ? `正在加载模型文件 ${msg.file} (${msg.progress}%)`
                    : `正在加载本地模型 (${msg.progress}%)`,
                }
              : j
          )
        );
        return;
      }

      if (msg.type === 'model-ready') {
        setActiveDeviceUsed(msg.deviceUsed);
        setDownloadState((prev) => ({
          ...prev,
          modelId: msg.modelId,
          status: 'ready',
          progress: 100,
        }));
        refreshCacheStatus();
        return;
      }

      if (msg.type === 'model-error') {
        setDownloadState((prev) => ({
          ...prev,
          modelId: msg.modelId,
          status: 'error',
          error: msg.error,
        }));
        setBanner({
          type: 'error',
          message: `模型加载失败：${msg.error}（可尝试切换「国内镜像 hf-mirror.com」重试）`,
        });
        return;
      }

      if (msg.type === 'transcribe-started') {
        checkpointSaveChainRef.current = checkpointSaveChainRef.current.then(() =>
          updateCheckpointStartMeta(
            msg.taskId,
            msg.totalSegments,
            msg.segmentBounds,
            msg.detectedLanguage
          )
        );
        setJobs((prev) =>
          prev.map((j) =>
            j.id === msg.taskId
              ? {
                  ...j,
                  checkpointTotalSegments: msg.totalSegments,
                  detectedLanguage: msg.detectedLanguage ?? j.detectedLanguage,
                }
              : j
          )
        );
        return;
      }

      if (msg.type === 'transcribe-progress') {
        if (msg.segmentCompleted) {
          const timing = activeTaskTimingRef.current;
          const elapsedSoFar =
            timing && timing.jobId === msg.taskId
              ? timing.baseElapsedMs + Math.round(performance.now() - timing.startedAt)
              : 0;
          checkpointSaveChainRef.current = checkpointSaveChainRef.current.then(() =>
            updateCheckpointProgress(
              msg.taskId,
              msg.segmentIndex,
              msg.segments,
              msg.detectedLanguage,
              elapsedSoFar
            )
          );
        }

        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== msg.taskId) return j;
            const scaledPct = Math.min(99, Math.max(30, 30 + Math.round(msg.progress * 0.69)));
            return {
              ...j,
              status: 'processing',
              step: 'transcribing',
              progress: msg.progress === 100 ? 99 : scaledPct,
              statusText: `正在识别第 ${msg.segmentIndex}/${msg.totalSegments} 段 · ${msg.progress}%`,
              liveText: msg.liveText,
              segments: msg.segments,
              detectedLanguage: msg.detectedLanguage ?? j.detectedLanguage,
              checkpointDoneSegments: msg.segmentCompleted
                ? msg.segmentIndex
                : j.checkpointDoneSegments,
              checkpointTotalSegments: msg.totalSegments,
            };
          })
        );
        return;
      }

      if (msg.type === 'transcribe-result') {
        const pending = pendingTasksRef.current.get(msg.taskId);
        if (pending) {
          pendingTasksRef.current.delete(msg.taskId);
          pending.resolve({
            text: msg.text,
            segments: msg.segments,
            deviceUsed: msg.deviceUsed,
            detectedLanguage: msg.detectedLanguage,
          });
        }
        return;
      }

      if (msg.type === 'transcribe-error') {
        const pending = pendingTasksRef.current.get(msg.taskId);
        if (pending) {
          pendingTasksRef.current.delete(msg.taskId);
          pending.reject(new Error(msg.error));
        }
      }
    };

    worker.postMessage({ type: 'detect-capabilities' });

    if (localModelFilesRef.current) {
      worker.postMessage({
        type: 'register-local-model',
        modelName: localModelFilesRef.current.name,
        files: localModelFilesRef.current.files,
      });
    }

    workerRef.current = worker;
    return worker;
  }, [refreshCacheStatus]);

  useEffect(() => {
    const w = initWorker();
    refreshCacheStatus();
    Promise.all([loadCheckpointsFromDB(), loadTranscriptsFromDB()]).then(
      ([checkpoints, history]) => {
        const merged = [...checkpoints, ...history];
        if (merged.length > 0) {
          setJobs((prev) => (prev.length === 0 ? merged : [...prev, ...merged]));
          setActiveJobId((prev) => prev ?? merged[0].id);
        }
        if (checkpoints.length > 0) {
          setBanner({
            type: 'info',
            message: `检测到 ${checkpoints.length} 个未完成的本地转写任务，已自动恢复断点进度；点击「继续转写」即可接着识别（完成后自动释放临时缓存）。`,
          });
        }
      }
    );
    return () => {
      w.terminate();
    };
  }, [initWorker, refreshCacheStatus]);

  const handleAddFiles = useCallback((fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    const valid = rawFiles.filter(isSupportedMediaFile);
    if (valid.length === 0) {
      setBanner({
        type: 'error',
        message: '未检测到支持的音视频格式（支持 MP3、WAV、M4A、FLAC、OGG、WebM、MP4、MOV 等）。',
      });
      return;
    }

    setBanner(null);
    const created: TranscriptJob[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      objectUrl: URL.createObjectURL(file),
      fileName: file.name,
      fileSize: file.size,
      mediaKind: detectMediaKind(file),
      duration: 0,
      status: 'ready',
      step: 'idle',
      progress: 0,
      statusText: '准备就绪',
      liveText: '',
      segments: [],
      fullText: '',
      createdAt: Date.now(),
    }));

    setJobs((prev) => [...created, ...prev]);
    setActiveJobId(created[0].id);
    setActiveTab('workspace');

    for (const item of created) {
      if (!item.objectUrl) continue;
      probeMediaDurationFromUrl(item.objectUrl, item.mediaKind).then((dur) => {
        if (dur > 0) {
          setJobs((prev) =>
            prev.map((j) => (j.id === item.id ? { ...j, duration: dur } : j))
          );
        }
      });
    }
  }, []);

  const handleRelinkFile = useCallback((id: string, file: File) => {
    const newUrl = URL.createObjectURL(file);
    const mediaKind = detectMediaKind(file);
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        if (j.objectUrl) URL.revokeObjectURL(j.objectUrl);
        return {
          ...j,
          file,
          objectUrl: newUrl,
          fileName: file.name,
          fileSize: file.size,
          mediaKind,
          status: 'ready',
          step: 'idle',
          progress: 0,
          statusText: '已重新载入文件',
          errorDetail: undefined,
          isHistoryOnly: false,
        };
      })
    );
    probeMediaDurationFromUrl(newUrl, mediaKind).then((dur) => {
      if (dur > 0) {
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, duration: dur } : j)));
      }
    });
  }, []);

  const runTranscribeJob = useCallback(
    async (jobId: string, overrideCfg?: SpeechConfig, options?: { forceRestart?: boolean }) => {
      const target = jobsRef.current.find((j) => j.id === jobId);
      const canUseCheckpoint = Boolean(target?.hasCheckpoint && !options?.forceRestart);
      if (!target || (!target.file && !canUseCheckpoint) || !workerRef.current || isProcessing) {
        return;
      }

      const cfg = overrideCfg ?? configRef.current;

      if (cfg.offlineOnly && !cfg.localModelName && !cacheMap[cfg.modelId]?.cached) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'error',
                  step: 'loading-model',
                  statusText: '离线缓存检查失败',
                  errorDetail:
                    '当前已开启「严格离线模式」，但所选模型尚未缓存。请先取消勾选离线模式完成一次缓存，或导入本地模型文件夹。',
                }
              : j
          )
        );
        return;
      }

      stopRequestedRef.current = false;
      setIsProcessing(true);
      setBanner(null);
      const startedAt = performance.now();

      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'processing',
                step: canUseCheckpoint ? 'loading-model' : 'decoding',
                progress: canUseCheckpoint ? Math.max(8, j.progress) : 4,
                statusText: canUseCheckpoint
                  ? '正在从本地断点恢复音频缓存...'
                  : '正在本地提取并重采样 16kHz 音轨...',
                liveText: '',
                errorDetail: undefined,
              }
            : j
        )
      );

      let failedStep: 'decoding' | 'loading-model' | 'transcribing' = canUseCheckpoint
        ? 'loading-model'
        : 'decoding';

      try {
        let audioData: Float32Array;
        let duration = target.duration;
        let startSegmentIndex = 0;
        let initialSegments: TranscriptSegment[] = [];
        let segmentBounds: import('./types/speech').AudioSegmentBound[] | undefined;
        let initialDetectedLanguage: string | undefined;
        let baseElapsedMs = 0;
        let hasCheckpoint = false;

        if (canUseCheckpoint) {
          const loaded = await loadCheckpointAudioData(jobId);
          if (loaded) {
            audioData = loaded.audioData;
            duration = loaded.duration || duration;
            startSegmentIndex = loaded.nextSegmentIndex;
            initialSegments = loaded.segments;
            segmentBounds = loaded.segmentBounds.length > 0 ? loaded.segmentBounds : undefined;
            initialDetectedLanguage = loaded.detectedLanguage;
            baseElapsedMs = loaded.elapsedMsSoFar;
            hasCheckpoint = true;
          } else if (target.file) {
            // Checkpoint chunks missing; transparently re-decode from source file
            failedStep = 'decoding';
            const decoded = await decodeMediaTo16kMono(target.file, (pct, detail) => {
              if (stopRequestedRef.current) return;
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === jobId && j.status === 'processing' && j.step === 'decoding'
                    ? {
                        ...j,
                        progress: Math.max(2, Math.min(9, Math.round(pct * 0.09))),
                        statusText: detail,
                      }
                    : j
                )
              );
            });
            audioData = decoded.audioData;
            duration = decoded.duration;
            hasCheckpoint = await saveCheckpointAudioAndMeta(
              { ...target, duration },
              audioData,
              cfg.modelId,
              cfg.language
            );
          } else {
            throw new Error(
              '本地断点音频缓存已被浏览器清理或失效，请点击「重新选择文件」再次导入原媒体文件。'
            );
          }
        } else {
          if (options?.forceRestart) {
            await deleteCheckpointFromDB(jobId);
          }
          const decoded = await decodeMediaTo16kMono(target.file!, (pct, detail) => {
            if (stopRequestedRef.current) return;
            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId && j.status === 'processing' && j.step === 'decoding'
                  ? {
                      ...j,
                      progress: Math.max(2, Math.min(9, Math.round(pct * 0.09))),
                      statusText: detail,
                    }
                  : j
              )
            );
          });
          if (stopRequestedRef.current) return;
          audioData = decoded.audioData;
          duration = decoded.duration;

          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    duration: duration || j.duration,
                    progress: 9,
                    statusText: '正在保存本地断点缓存以防误刷新中断...',
                  }
                : j
            )
          );

          hasCheckpoint = await saveCheckpointAudioAndMeta(
            { ...target, duration },
            audioData,
            cfg.modelId,
            cfg.language
          );
        }

        if (stopRequestedRef.current) return;

        activeTaskTimingRef.current = { jobId, startedAt, baseElapsedMs };
        failedStep = 'loading-model';
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  duration: duration || j.duration,
                  step: 'loading-model',
                  progress: Math.max(10, j.progress),
                  statusText:
                    startSegmentIndex > 0
                      ? `正在载入本地 Whisper 模型（将从第 ${startSegmentIndex + 1} 段继续）...`
                      : '正在载入本地 Whisper 模型...',
                  hasCheckpoint,
                }
              : j
          )
        );

        const result = await new Promise<{
          text: string;
          segments: TranscriptSegment[];
          deviceUsed: 'webgpu' | 'wasm';
          detectedLanguage?: string;
        }>((resolve, reject) => {
          pendingTasksRef.current.set(jobId, { resolve, reject });
          failedStep = 'transcribing';

          workerRef.current?.postMessage(
            {
              type: 'transcribe',
              taskId: jobId,
              audioData,
              duration,
              modelId: cfg.modelId,
              device: cfg.device,
              language: cfg.language,
              remoteHost: resolveRemoteHost(cfg),
              offlineOnly: cfg.offlineOnly,
              useLocalFolderModel: Boolean(cfg.localModelName),
              startSegmentIndex,
              initialSegments,
              segmentBounds,
              initialDetectedLanguage,
            },
            [audioData.buffer]
          );
        });

        await checkpointSaveChainRef.current;
        const elapsedMs = baseElapsedMs + Math.round(performance.now() - startedAt);
        const completedAt = Date.now();
        const finalText = result.text || formatSegmentsText(result.segments, '', false);

        let completedSnapshot: TranscriptJob | null = null;
        setJobs((prev) =>
          prev.map((j) => {
            if (j.id !== jobId) return j;
            completedSnapshot = {
              ...j,
              duration: duration || j.duration,
              status: 'completed',
              step: 'done',
              progress: 100,
              statusText: '已完成（临时断点缓存已自动清理）',
              liveText: '',
              segments: result.segments,
              fullText: finalText,
              elapsedMs,
              elapsedMsSoFar: undefined,
              deviceUsed: result.deviceUsed,
              detectedLanguage: result.detectedLanguage,
              modelUsed: cfg.localModelName || cfg.modelId,
              completedAt,
              hasCheckpoint: false,
              checkpointDoneSegments: undefined,
              checkpointTotalSegments: undefined,
            };
            return completedSnapshot;
          })
        );

        if (completedSnapshot) {
          await saveTranscriptToDB(completedSnapshot);
        }
        // 转换完成后自动删除硬盘中的临时断点音频缓存
        await deleteCheckpointFromDB(jobId);
      } catch (err) {
        if (stopRequestedRef.current) return;
        const raw = err instanceof Error ? err.message : String(err);
        let friendly = raw;
        if (
          raw.includes('Failed to fetch') ||
          raw.includes('NetworkError') ||
          raw.includes('404') ||
          raw.includes('Could not locate file')
        ) {
          friendly = `模型文件下载或定位失败（${raw}）。建议点击下方「改用智能多镜像重试」。`;
          failedStep = 'loading-model';
        }

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'error',
                  step: failedStep,
                  progress: j.hasCheckpoint ? j.progress : 0,
                  statusText:
                    failedStep === 'decoding'
                      ? '音频提取失败'
                      : failedStep === 'loading-model'
                        ? '模型加载失败'
                        : '语音识别出错',
                  errorDetail: friendly,
                }
              : j
          )
        );
      } finally {
        if (activeTaskTimingRef.current?.jobId === jobId) {
          activeTaskTimingRef.current = null;
        }
        setIsProcessing(false);
      }
    },
    [cacheMap, isProcessing]
  );

  const handleStopTranscribe = useCallback(() => {
    stopRequestedRef.current = true;
    for (const [, pending] of pendingTasksRef.current.entries()) {
      pending.reject(new Error('已手动暂停'));
    }
    pendingTasksRef.current.clear();
    initWorker();

    setJobs((prev) =>
      prev.map((j) => {
        if (j.status !== 'processing') return j;
        const canResume = Boolean(j.hasCheckpoint);
        const doneSegs = j.checkpointDoneSegments ?? 0;
        const totalSegs = j.checkpointTotalSegments ?? 0;
        return {
          ...j,
          status: canResume ? 'interrupted' : 'cancelled',
          step: canResume && totalSegs > 0 ? 'transcribing' : 'idle',
          progress: canResume ? j.progress : 0,
          statusText:
            canResume && totalSegs > 0
              ? `已暂停于第 ${doneSegs}/${totalSegs} 段，可点击「继续转写」`
              : canResume
                ? '已暂停，已保留本地断点缓存，可点击「继续转写」'
                : '已停止',
          liveText: '',
        };
      })
    );
    activeTaskTimingRef.current = null;
    setIsProcessing(false);
  }, [initWorker]);

  const handleRetryWithMirror = useCallback(
    (jobId: string) => {
      const nextCfg: SpeechConfig = { ...configRef.current, downloadSource: 'hf-mirror' };
      setConfig(nextCfg);
      runTranscribeJob(jobId, nextCfg);
    },
    [runTranscribeJob]
  );

  const handleRetryWithWasm = useCallback(
    (jobId: string) => {
      const nextCfg: SpeechConfig = { ...configRef.current, device: 'wasm' };
      setConfig(nextCfg);
      runTranscribeJob(jobId, nextCfg);
    },
    [runTranscribeJob]
  );

  const handleUpdateText = useCallback((jobId: string, nextText: string) => {
    let updated: TranscriptJob | null = null;
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        updated = { ...j, fullText: nextText };
        return updated;
      })
    );
    if (updated && (updated as TranscriptJob).status === 'completed') {
      saveTranscriptToDB(updated);
    }
  }, []);

  const handleConvertSimplified = useCallback((jobId: string) => {
    let updated: TranscriptJob | null = null;
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const convertedSegments = j.segments.map((seg) => ({
          ...seg,
          text: convertToSimplifiedChinese(seg.text),
        }));
        const convertedFullText = convertToSimplifiedChinese(j.fullText);
        updated = {
          ...j,
          segments: convertedSegments,
          fullText: convertedFullText,
        };
        return updated;
      })
    );
    if (updated && (updated as TranscriptJob).status === 'completed') {
      saveTranscriptToDB(updated);
    }
  }, []);

  const handleExportTxt = useCallback((job: TranscriptJob, includeTimestamps: boolean) => {
    const content =
      includeTimestamps && job.segments.length > 0
        ? formatSegmentsText(job.segments, job.fullText, true)
        : job.fullText;
    if (!content.trim()) return;
    downloadTxtFile(content.trim() + '\n', `${getBaseFileName(job.fileName)}.txt`);
  }, []);

  const handleRemoveJob = useCallback((id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
      const next = prev.filter((j) => j.id !== id);
      setActiveJobId((curr) => (curr === id ? (next[0]?.id ?? null) : curr));
      return next;
    });
    deleteTranscriptFromDB(id);
    deleteCheckpointFromDB(id);
  }, []);

  const handleDiscardCheckpoint = useCallback(async (id: string) => {
    await deleteCheckpointFromDB(id);
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? {
              ...j,
              status: j.file ? 'ready' : 'cancelled',
              step: 'idle',
              progress: 0,
              statusText: j.file ? '准备就绪（已清除断点）' : '已清除断点缓存',
              segments: [],
              fullText: '',
              hasCheckpoint: false,
              checkpointDoneSegments: undefined,
              checkpointTotalSegments: undefined,
              elapsedMsSoFar: undefined,
            }
          : j
      )
    );
  }, []);

  const handlePreloadModel = useCallback(
    (modelId?: WhisperModelId) => {
      const targetId = modelId ?? config.modelId;
      setBanner(null);
      setDownloadState({
        modelId: targetId,
        status: 'downloading',
        progress: 0,
        loadedBytes: 0,
        totalBytes: 0,
        currentFile: '连接模型源...',
      });
      workerRef.current?.postMessage({
        type: 'preload-model',
        modelId: targetId,
        device: config.device,
        remoteHost: resolveRemoteHost(config),
        offlineOnly: config.offlineOnly,
      });
    },
    [config]
  );

  const handleDeleteModelCache = useCallback(
    async (modelId: WhisperModelId) => {
      await clearModelCache(modelId);
      await refreshCacheStatus();
      setBanner({ type: 'info', message: `已清除 ${modelId} 本地缓存。` });
    },
    [refreshCacheStatus]
  );

  const handleSelectLocalModelFolder = useCallback((files: FileList) => {
    const entries: WorkerLocalFileEntry[] = [];
    let folderName = '本地模型';
    for (const file of Array.from(files)) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (folderName === '本地模型' && rel.includes('/')) {
        folderName = rel.split('/')[0];
      }
      entries.push({ relativePath: rel, file });
    }

    const hasConfig = entries.some((e) => e.relativePath.endsWith('config.json'));
    const hasOnnx = entries.some((e) => e.relativePath.endsWith('.onnx'));
    if (!hasConfig || !hasOnnx) {
      setBanner({
        type: 'error',
        message: '所选文件夹缺少 config.json 或 .onnx 文件，请选择完整的 Whisper ONNX 模型目录。',
      });
      return;
    }

    localModelFilesRef.current = { name: folderName, files: entries };
    setConfig((prev) => ({ ...prev, localModelName: folderName }));
    workerRef.current?.postMessage({
      type: 'register-local-model',
      modelName: folderName,
      files: entries,
    });
  }, []);

  const handleClearLocalModelFolder = useCallback(() => {
    localModelFilesRef.current = null;
    setConfig((prev) => ({ ...prev, localModelName: null }));
    workerRef.current?.postMessage({ type: 'clear-local-model' });
  }, []);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? null,
    [jobs, activeJobId]
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <input
        ref={globalFilePickerRef}
        type="file"
        multiple
        accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.opus"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleAddFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenFilePicker={() => globalFilePickerRef.current?.click()}
      />

      {isProcessing && (
        <div
          role="alert"
          className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm"
        >
          <span>
            正在进行本地语音转写：请勿关闭或刷新浏览器（已启用屏幕常亮防休眠，并同步保存断点以防意外中断）。
          </span>
        </div>
      )}

      {/* Mobile Navigation */}
      <nav
        aria-label="移动端导航"
        className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-1.5 md:hidden dark:border-slate-800 dark:bg-slate-900"
      >
        {(
          [
            { id: 'workspace', label: '语音转文字' },
            { id: 'models', label: '离线模型' },
            { id: 'guide', label: '使用说明' },
          ] as Array<{ id: ActiveTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-4 border-b px-6 py-2.5 text-xs ${
            banner.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
          }`}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="font-medium underline shrink-0"
          >
            关闭
          </button>
        </div>
      )}

      {activeTab === 'workspace' && (
        <main className="flex flex-1 flex-col lg:h-[calc(100vh-3.5rem)] lg:flex-row lg:overflow-hidden">
          <ConfigSidebar
            config={config}
            onChangeConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
            webgpuSupported={webgpuSupported}
            activeDeviceUsed={activeDeviceUsed}
            cacheMap={cacheMap}
            downloadState={downloadState}
            onPreloadModel={() => handlePreloadModel()}
            onSelectLocalModelFolder={handleSelectLocalModelFolder}
            onClearLocalModelFolder={handleClearLocalModelFolder}
            isOnline={isOnline}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          />

          <SpeechWorkspace
            jobs={jobs}
            activeJob={activeJob}
            isProcessing={isProcessing}
            onSelectJob={setActiveJobId}
            onAddFiles={handleAddFiles}
            onRelinkFile={handleRelinkFile}
            onStartTranscribe={(id, forceRestart) =>
              runTranscribeJob(id, undefined, { forceRestart })
            }
            onStopTranscribe={handleStopTranscribe}
            onDiscardCheckpoint={handleDiscardCheckpoint}
            onRetryWithMirror={handleRetryWithMirror}
            onRetryWithWasm={handleRetryWithWasm}
            onUpdateText={handleUpdateText}
            onConvertSimplified={handleConvertSimplified}
            onExportTxt={handleExportTxt}
            onRemoveJob={handleRemoveJob}
            onOpenGuide={() => setActiveTab('guide')}
          />
        </main>
      )}

      {activeTab === 'models' && (
        <main className="flex-1 overflow-y-auto">
          <ModelsView
            config={config}
            onChangeConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
            cacheMap={cacheMap}
            downloadState={downloadState}
            onPreloadModel={(id) => handlePreloadModel(id)}
            onDeleteModelCache={handleDeleteModelCache}
            onSelectLocalModelFolder={handleSelectLocalModelFolder}
            onClearLocalModelFolder={handleClearLocalModelFolder}
          />
        </main>
      )}

      {activeTab === 'guide' && (
        <main className="flex-1 overflow-y-auto">
          <GuideView />
        </main>
      )}
    </div>
  );
}
