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
  deleteTranscriptFromDB,
  inspectModelCaches,
  loadTranscriptsFromDB,
  saveTranscriptToDB,
} from './utils/storage';
import {
  downloadTxtFile,
  formatSegmentsText,
  getBaseFileName,
} from './utils/textFormatter';
import type { SpeechWorkerOutgoing, WorkerLocalFileEntry } from './workers/speechWorker';

const DEFAULT_CONFIG: SpeechConfig = {
  modelId: 'Xenova/whisper-base',
  device: 'auto',
  language: 'chinese',
  downloadSource: 'huggingface',
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

      if (msg.type === 'transcribe-progress') {
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
    loadTranscriptsFromDB().then((history) => {
      if (history.length > 0) {
        setJobs((prev) => (prev.length === 0 ? history : [...prev, ...history]));
        setActiveJobId((prev) => prev ?? history[0].id);
      }
    });
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
    async (jobId: string, overrideCfg?: SpeechConfig) => {
      const target = jobsRef.current.find((j) => j.id === jobId);
      if (!target || !target.file || !workerRef.current || isProcessing) return;

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
                step: 'decoding',
                progress: 4,
                statusText: '正在本地提取并重采样 16kHz 音轨...',
                liveText: '',
                errorDetail: undefined,
              }
            : j
        )
      );

      let failedStep: 'decoding' | 'loading-model' | 'transcribing' = 'decoding';

      try {
        const { audioData, duration } = await decodeMediaTo16kMono(
          target.file,
          (pct, detail) => {
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
          }
        );
        if (stopRequestedRef.current) return;

        failedStep = 'loading-model';
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  duration: duration || j.duration,
                  step: 'loading-model',
                  progress: 10,
                  statusText: '正在载入本地 Whisper 模型...',
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
            },
            [audioData.buffer]
          );
        });

        const elapsedMs = Math.round(performance.now() - startedAt);
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
              statusText: '已完成',
              liveText: '',
              segments: result.segments,
              fullText: finalText,
              elapsedMs,
              deviceUsed: result.deviceUsed,
              detectedLanguage: result.detectedLanguage,
              modelUsed: cfg.localModelName || cfg.modelId,
              completedAt,
            };
            return completedSnapshot;
          })
        );

        if (completedSnapshot) {
          await saveTranscriptToDB(completedSnapshot);
        }
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
          friendly = `模型文件下载或定位失败（${raw}）。建议点击下方「改用国内镜像 (hf-mirror.com) 重试」。`;
          failedStep = 'loading-model';
        }

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: 'error',
                  step: failedStep,
                  progress: 0,
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
        setIsProcessing(false);
      }
    },
    [cacheMap, isProcessing]
  );

  const handleStopTranscribe = useCallback(() => {
    stopRequestedRef.current = true;
    for (const [, pending] of pendingTasksRef.current.entries()) {
      pending.reject(new Error('已手动停止'));
    }
    pendingTasksRef.current.clear();
    initWorker();

    setJobs((prev) =>
      prev.map((j) =>
        j.status === 'processing'
          ? {
              ...j,
              status: 'cancelled',
              step: 'idle',
              progress: 0,
              statusText: '已停止',
              liveText: '',
            }
          : j
      )
    );
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
            onStartTranscribe={(id) => runTranscribeJob(id)}
            onStopTranscribe={handleStopTranscribe}
            onRetryWithMirror={handleRetryWithMirror}
            onRetryWithWasm={handleRetryWithWasm}
            onUpdateText={handleUpdateText}
            onExportTxt={handleExportTxt}
            onRemoveJob={handleRemoveJob}
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
