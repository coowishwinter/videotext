import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BatchQueuePane } from './components/BatchQueuePane';
import { FormatGuideView } from './components/FormatGuideView';
import { ModelsManagerView } from './components/ModelsManagerView';
import { PrivacyGuideView } from './components/PrivacyGuideView';
import { SidebarConfig } from './components/SidebarConfig';
import { TopHeader } from './components/TopHeader';
import { TranscriptInspector } from './components/TranscriptInspector';
import {
  ActiveNavTab,
  EngineConfig,
  ExportSettings,
  MediaQueueItem,
  ModelCacheStatus,
  ModelDownloadProgress,
  SubtitleChunk,
  WhisperModelId,
} from './types/transcribe';
import {
  decodeMediaTo16kMono,
  detectMediaKind,
  isSupportedMediaFile,
  probeMediaDuration,
} from './utils/audioDecoder';
import {
  clearModelCache,
  deleteTranscriptFromDB,
  inspectModelCaches,
  loadTranscriptsFromDB,
  saveTranscriptToDB,
} from './utils/storage';
import {
  downloadTextFile,
  exportBatchAsZip,
  exportMergedTxt,
  generateSrt,
  generateTxt,
  getBaseFileName,
  normalizeWhisperChunks,
} from './utils/subtitleFormatter';
import type { WorkerLocalFileEntry, WorkerOutgoingMessage } from './workers/whisperWorker';

const DEFAULT_CONFIG: EngineConfig = {
  modelId: 'Xenova/whisper-base',
  device: 'auto',
  language: 'auto',
  task: 'transcribe',
  remoteHost: 'https://huggingface.co/',
  offlineOnly: false,
  localModelLoadedName: null,
};

const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  srtIncludeBom: true,
  srtMaxLineChars: 24,
  txtMode: 'lines',
  txtIncludeTitle: false,
};

const STORAGE_CONFIG_KEY = 'shengji_engine_config_v1';
const STORAGE_EXPORT_KEY = 'shengji_export_settings_v1';
const STORAGE_THEME_KEY = 'shengji_theme_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveNavTab>('workspace');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [config, setConfig] = useState<EngineConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (saved) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved), localModelLoadedName: null };
      }
    } catch {
      // ignore
    }
    return DEFAULT_CONFIG;
  });

  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_EXPORT_KEY);
      if (saved) return { ...DEFAULT_EXPORT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_EXPORT_SETTINGS;
  });

  const [queue, setQueue] = useState<MediaQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [webgpuSupported, setWebgpuSupported] = useState<boolean | null>(null);
  const [activeDeviceUsed, setActiveDeviceUsed] = useState<'webgpu' | 'wasm' | null>(null);
  const [cacheMap, setCacheMap] = useState<Record<string, ModelCacheStatus>>({});
  const [downloadState, setDownloadState] = useState<ModelDownloadProgress>({
    modelId: DEFAULT_CONFIG.modelId,
    status: 'idle',
    progress: 0,
    loadedBytes: 0,
    totalBytes: 0,
    currentFile: '',
  });
  const [noticeBanner, setNoticeBanner] = useState<{
    type: 'info' | 'error';
    message: string;
  } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const stopRequestedRef = useRef(false);
  const queueRef = useRef<MediaQueueItem[]>([]);
  const configRef = useRef<EngineConfig>(config);
  const localModelFilesRef = useRef<{ name: string; files: WorkerLocalFileEntry[] } | null>(null);
  const globalFilePickerRef = useRef<HTMLInputElement>(null);

  // Pending task promise resolver map for worker transcription tasks
  const pendingTasksRef = useRef<
    Map<
      string,
      {
        resolve: (val: {
          text: string;
          chunks: Array<{ timestamp: [number | null, number | null]; text: string }>;
          deviceUsed: 'webgpu' | 'wasm';
        }) => void;
        reject: (err: Error) => void;
        duration: number;
      }
    >
  >(new Map());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    configRef.current = config;
    try {
      const { localModelLoadedName: _ignored, ...persistable } = config;
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(persistable));
    } catch {
      // ignore
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EXPORT_KEY, JSON.stringify(exportSettings));
    } catch {
      // ignore
    }
  }, [exportSettings]);

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
    const worker = new Worker(new URL('./workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const msg = event.data;

      if (msg.type === 'capabilities') {
        setWebgpuSupported(msg.webgpuSupported);
        return;
      }

      if (msg.type === 'local-model-registered') {
        setNoticeBanner({
          type: 'info',
          message: `已挂载本地模型目录「${msg.modelName}」（共 ${msg.fileCount} 个文件），可完全断网使用。`,
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
        setNoticeBanner({
          type: 'error',
          message: `模型加载失败：${msg.error}`,
        });
        return;
      }

      if (msg.type === 'transcribe-progress') {
        setQueue((prev) =>
          prev.map((item) =>
            item.id === msg.taskId
              ? {
                  ...item,
                  status: 'transcribing',
                  progress: msg.progress,
                  stageText: `识别第 ${msg.chunkIndex}/${msg.totalChunks} 段 · ${msg.progress}%`,
                  streamingText: msg.streamingText,
                }
              : item
          )
        );
        return;
      }

      if (msg.type === 'transcribe-result') {
        const pending = pendingTasksRef.current.get(msg.taskId);
        if (pending) {
          pendingTasksRef.current.delete(msg.taskId);
          pending.resolve({
            text: msg.text,
            chunks: msg.chunks,
            deviceUsed: msg.deviceUsed,
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
    loadTranscriptsFromDB().then((historyItems) => {
      if (historyItems.length > 0) {
        setQueue((prev) => (prev.length === 0 ? historyItems : [...prev, ...historyItems]));
        setSelectedId((prev) => prev ?? historyItems[0].id);
      }
    });

    return () => {
      w.terminate();
    };
  }, [initWorker, refreshCacheStatus]);

  const handleAddFiles = useCallback(async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    const validFiles = rawFiles.filter(isSupportedMediaFile);
    if (validFiles.length === 0) {
      setNoticeBanner({
        type: 'error',
        message: '未检测到支持的音视频文件（支持 MP4、MOV、WebM、MKV、MP3、WAV、M4A、FLAC、OGG 等）。',
      });
      return;
    }

    setNoticeBanner(null);
    const newItems: MediaQueueItem[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      objectUrl: URL.createObjectURL(file),
      fileName: file.name,
      fileSize: file.size,
      fileType: detectMediaKind(file),
      mimeType: file.type || '',
      duration: 0,
      status: 'queued',
      progress: 0,
      stageText: '等待转录',
      chunks: [],
      fullText: '',
      createdAt: Date.now(),
      selectedForExport: true,
    }));

    setQueue((prev) => [...newItems, ...prev]);
    setSelectedId((prev) => prev ?? newItems[0].id);
    setActiveTab('workspace');

    // Probe durations asynchronously so queue displays accurate total time immediately
    for (const item of newItems) {
      if (!item.file) continue;
      probeMediaDuration(item.file).then((dur) => {
        if (dur > 0) {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, duration: dur } : q))
          );
        }
      });
    }
  }, []);

  const runSingleItem = useCallback(async (item: MediaQueueItem) => {
    if (!item.file || !workerRef.current) return;
    const cfg = configRef.current;

    if (
      cfg.offlineOnly &&
      !cfg.localModelLoadedName &&
      !cacheMap[cfg.modelId]?.cached
    ) {
      const msg =
        '当前开启了「严格离线模式」，但所选模型尚未缓存到本地。请先关闭严格离线模式下载模型，或导入本地模型文件夹。';
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'error', errorMessage: msg } : q
        )
      );
      return;
    }

    const startedAt = performance.now();
    setQueue((prev) =>
      prev.map((q) =>
        q.id === item.id
          ? {
              ...q,
              status: 'decoding',
              progress: 3,
              stageText: '正在本地提取音轨...',
              errorMessage: undefined,
              streamingText: '',
            }
          : q
      )
    );

    try {
      const { audioData, duration } = await decodeMediaTo16kMono(item.file);
      if (stopRequestedRef.current) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'cancelled', progress: 0, stageText: '已暂停' }
              : q
          )
        );
        return;
      }

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                duration: duration || q.duration,
                status: 'transcribing',
                progress: 6,
                stageText: '正在载入本地模型...',
              }
            : q
        )
      );

      const result = await new Promise<{
        text: string;
        chunks: Array<{ timestamp: [number | null, number | null]; text: string }>;
        deviceUsed: 'webgpu' | 'wasm';
      }>((resolve, reject) => {
        pendingTasksRef.current.set(item.id, {
          resolve,
          reject,
          duration: duration || item.duration,
        });

        workerRef.current?.postMessage(
          {
            type: 'transcribe',
            taskId: item.id,
            audioData,
            duration,
            modelId: cfg.modelId,
            device: cfg.device,
            language: cfg.language,
            task: cfg.task,
            remoteHost: cfg.remoteHost,
            offlineOnly: cfg.offlineOnly,
            useLocalFolderModel: Boolean(cfg.localModelLoadedName),
          },
          [audioData.buffer]
        );
      });

      const normalizedChunks = normalizeWhisperChunks(
        result.chunks,
        result.text,
        duration || item.duration
      );
      const finalFullText =
        normalizedChunks.map((c) => c.text).join('\n') || result.text;
      const elapsedMs = Math.round(performance.now() - startedAt);
      const completedAt = Date.now();

      let completedSnapshot: MediaQueueItem | null = null;
      setQueue((prev) =>
        prev.map((q) => {
          if (q.id !== item.id) return q;
          completedSnapshot = {
            ...q,
            duration: duration || q.duration,
            status: 'completed',
            progress: 100,
            stageText: '已完成',
            streamingText: undefined,
            chunks: normalizedChunks,
            fullText: finalFullText,
            modelUsed: cfg.localModelLoadedName || cfg.modelId,
            languageUsed: cfg.language,
            completedAt,
            elapsedMs,
          };
          return completedSnapshot;
        })
      );

      if (completedSnapshot) {
        await saveTranscriptToDB(completedSnapshot);
      }
    } catch (err) {
      if (stopRequestedRef.current) return;
      const rawMsg = err instanceof Error ? err.message : String(err);
      const friendlyMsg =
        rawMsg.includes('local_files_only') || rawMsg.includes('Could not locate file')
          ? '离线模式下未能找到完整的模型缓存文件，请先联网缓存该模型或导入本地模型文件夹。'
          : rawMsg;

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                status: 'error',
                progress: 0,
                stageText: '处理失败',
                errorMessage: friendlyMsg,
              }
            : q
        )
      );
    }
  }, [cacheMap]);

  const handleStartBatch = useCallback(async () => {
    if (isBatchRunning) return;
    stopRequestedRef.current = false;
    setIsBatchRunning(true);
    setNoticeBanner(null);

    const pendingIds = queueRef.current
      .filter(
        (item) =>
          Boolean(item.file) &&
          (item.status === 'queued' || item.status === 'cancelled' || item.status === 'error')
      )
      .map((i) => i.id);

    for (const id of pendingIds) {
      if (stopRequestedRef.current) break;
      const latestItem = queueRef.current.find((q) => q.id === id);
      if (!latestItem || !latestItem.file) continue;
      setSelectedId(latestItem.id);
      await runSingleItem(latestItem);
    }

    setIsBatchRunning(false);
  }, [isBatchRunning, runSingleItem]);

  const handleStopBatch = useCallback(() => {
    stopRequestedRef.current = true;
    for (const [, pending] of pendingTasksRef.current.entries()) {
      pending.reject(new Error('用户已停止处理'));
    }
    pendingTasksRef.current.clear();

    // Terminate active worker to halt WASM/WebGPU inference immediately, then respawn clean worker
    initWorker();

    setQueue((prev) =>
      prev.map((item) =>
        item.status === 'decoding' || item.status === 'transcribing'
          ? { ...item, status: 'cancelled', progress: 0, stageText: '已暂停' }
          : item
      )
    );
    setIsBatchRunning(false);
  }, [initWorker]);

  const handleTranscribeSingle = useCallback(
    async (id: string) => {
      if (isBatchRunning) return;
      const target = queueRef.current.find((q) => q.id === id);
      if (!target || !target.file) return;
      stopRequestedRef.current = false;
      setIsBatchRunning(true);
      setSelectedId(target.id);
      await runSingleItem(target);
      setIsBatchRunning(false);
    },
    [isBatchRunning, runSingleItem]
  );

  const handleRemoveItem = useCallback(
    (id: string) => {
      setQueue((prev) => {
        const target = prev.find((q) => q.id === id);
        if (target?.objectUrl) {
          URL.revokeObjectURL(target.objectUrl);
        }
        return prev.filter((q) => q.id !== id);
      });
      deleteTranscriptFromDB(id);
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    []
  );

  const handleClearCompleted = useCallback(() => {
    setQueue((prev) => {
      const remaining: MediaQueueItem[] = [];
      for (const item of prev) {
        if (item.status === 'completed') {
          if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
          deleteTranscriptFromDB(item.id);
        } else {
          remaining.push(item);
        }
      }
      return remaining;
    });
  }, []);

  const handleUpdateChunks = useCallback((itemId: string, nextChunks: SubtitleChunk[]) => {
    const nextFullText = nextChunks.map((c) => c.text.trim()).join('\n');
    let updatedItem: MediaQueueItem | null = null;
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        updatedItem = { ...item, chunks: nextChunks, fullText: nextFullText };
        return updatedItem;
      })
    );
    if (updatedItem) {
      saveTranscriptToDB(updatedItem);
    }
  }, []);

  const handleExportSingleSrt = useCallback(
    (item: MediaQueueItem) => {
      const srt = generateSrt(item.chunks, { maxLineChars: exportSettings.srtMaxLineChars });
      downloadTextFile(
        srt,
        `${getBaseFileName(item.fileName)}.srt`,
        exportSettings.srtIncludeBom
      );
    },
    [exportSettings]
  );

  const handleExportSingleTxt = useCallback(
    (item: MediaQueueItem) => {
      const txt = generateTxt(item.chunks, item.fullText, {
        mode: exportSettings.txtMode,
        title: exportSettings.txtIncludeTitle ? item.fileName : undefined,
      });
      downloadTextFile(
        txt,
        `${getBaseFileName(item.fileName)}.txt`,
        exportSettings.srtIncludeBom
      );
    },
    [exportSettings]
  );

  const handleBatchExportZip = useCallback(
    async (format: 'srt' | 'txt' | 'both') => {
      const targets = queue.filter((i) => i.status === 'completed' && i.selectedForExport);
      if (targets.length === 0) return;
      await exportBatchAsZip(targets, format, exportSettings);
    },
    [queue, exportSettings]
  );

  const handleBatchExportMergedTxt = useCallback(() => {
    const targets = queue.filter((i) => i.status === 'completed' && i.selectedForExport);
    if (targets.length === 0) return;
    exportMergedTxt(targets, exportSettings);
  }, [queue, exportSettings]);

  const handlePreloadModel = useCallback(
    (modelId?: WhisperModelId) => {
      const targetId = modelId ?? config.modelId;
      setNoticeBanner(null);
      setDownloadState({
        modelId: targetId,
        status: 'downloading',
        progress: 0,
        loadedBytes: 0,
        totalBytes: 0,
        currentFile: '连接模型资源...',
      });
      workerRef.current?.postMessage({
        type: 'preload-model',
        modelId: targetId,
        device: config.device,
        remoteHost: config.remoteHost,
        offlineOnly: config.offlineOnly,
      });
    },
    [config]
  );

  const handleDeleteModelCache = useCallback(
    async (modelId: WhisperModelId) => {
      await clearModelCache(modelId);
      await refreshCacheStatus();
      setNoticeBanner({
        type: 'info',
        message: `已清除 ${modelId} 的本地缓存。`,
      });
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
      setNoticeBanner({
        type: 'error',
        message: '所选文件夹缺少 config.json 或 .onnx 模型文件，请确认选择的是有效的 ONNX Whisper 模型目录。',
      });
      return;
    }

    localModelFilesRef.current = { name: folderName, files: entries };
    setConfig((prev) => ({ ...prev, localModelLoadedName: folderName }));
    workerRef.current?.postMessage({
      type: 'register-local-model',
      modelName: folderName,
      files: entries,
    });
  }, []);

  const handleClearLocalModelFolder = useCallback(() => {
    localModelFilesRef.current = null;
    setConfig((prev) => ({ ...prev, localModelLoadedName: null }));
    workerRef.current?.postMessage({ type: 'clear-local-model' });
  }, []);

  const selectedItem = useMemo(
    () => queue.find((q) => q.id === selectedId) ?? null,
    [queue, selectedId]
  );

  const stats = useMemo(() => {
    let completedFiles = 0;
    let totalDuration = 0;
    let totalCharacters = 0;
    for (const item of queue) {
      totalDuration += item.duration || 0;
      if (item.status === 'completed') {
        completedFiles++;
        totalCharacters += item.fullText.replace(/\s+/g, '').length;
      }
    }
    return {
      totalFiles: queue.length,
      completedFiles,
      totalDuration,
      totalCharacters,
    };
  }, [queue]);

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

      <TopHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenFilePicker={() => globalFilePickerRef.current?.click()}
      />

      {/* Mobile Navigation Sub-bar */}
      <nav
        aria-label="移动端导航"
        className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-1.5 md:hidden dark:border-slate-800 dark:bg-slate-900"
      >
        {(
          [
            { id: 'workspace', label: '转录工作台' },
            { id: 'models', label: '离线模型库' },
            { id: 'formats', label: '导出规范' },
            { id: 'privacy', label: '隐私与说明' },
          ] as Array<{ id: ActiveNavTab; label: string }>
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

      {/* Notice Banner (errors or model mount feedback) */}
      {noticeBanner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-4 border-b px-6 py-2.5 text-xs ${
            noticeBanner.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
              : 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300'
          }`}
        >
          <span>{noticeBanner.message}</span>
          <button
            type="button"
            onClick={() => setNoticeBanner(null)}
            className="font-medium underline shrink-0"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main View */}
      {activeTab === 'workspace' && (
        <main className="flex flex-1 flex-col lg:h-[calc(100vh-3.5rem)] lg:flex-row lg:overflow-hidden">
          <SidebarConfig
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
            stats={stats}
          />

          <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
            <BatchQueuePane
              items={queue}
              selectedId={selectedId}
              isBatchRunning={isBatchRunning}
              onSelectItem={setSelectedId}
              onAddFiles={handleAddFiles}
              onStartAll={handleStartBatch}
              onStopBatch={handleStopBatch}
              onTranscribeSingle={handleTranscribeSingle}
              onRemoveItem={handleRemoveItem}
              onClearCompleted={handleClearCompleted}
              onToggleSelectForExport={(id) =>
                setQueue((prev) =>
                  prev.map((q) =>
                    q.id === id ? { ...q, selectedForExport: !q.selectedForExport } : q
                  )
                )
              }
              onToggleSelectAllForExport={(checked) =>
                setQueue((prev) =>
                  prev.map((q) =>
                    q.status === 'completed' ? { ...q, selectedForExport: checked } : q
                  )
                )
              }
              onExportSingleSrt={handleExportSingleSrt}
              onExportSingleTxt={handleExportSingleTxt}
              onBatchExportZip={handleBatchExportZip}
              onBatchExportMergedTxt={handleBatchExportMergedTxt}
            />

            <TranscriptInspector
              item={selectedItem}
              exportSettings={exportSettings}
              onChangeExportSettings={(patch) =>
                setExportSettings((prev) => ({ ...prev, ...patch }))
              }
              onUpdateChunks={handleUpdateChunks}
              onExportSrt={handleExportSingleSrt}
              onExportTxt={handleExportSingleTxt}
            />
          </div>
        </main>
      )}

      {activeTab === 'models' && (
        <main className="flex-1">
          <ModelsManagerView
            config={config}
            onChangeConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
            cacheMap={cacheMap}
            downloadState={downloadState}
            onPreloadSpecificModel={(id) => handlePreloadModel(id)}
            onDeleteModelCache={handleDeleteModelCache}
            onSelectLocalModelFolder={handleSelectLocalModelFolder}
            onClearLocalModelFolder={handleClearLocalModelFolder}
          />
        </main>
      )}

      {activeTab === 'formats' && (
        <main className="flex-1">
          <FormatGuideView
            settings={exportSettings}
            onChangeSettings={(patch) =>
              setExportSettings((prev) => ({ ...prev, ...patch }))
            }
          />
        </main>
      )}

      {activeTab === 'privacy' && (
        <main className="flex-1">
          <PrivacyGuideView />
        </main>
      )}
    </div>
  );
}
