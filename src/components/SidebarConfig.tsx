import React, { useRef } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FolderInput,
  HardDrive,
  Moon,
  ShieldCheck,
  Sun,
  WifiOff,
  Wifi,
} from 'lucide-react';
import {
  EngineConfig,
  LANGUAGE_OPTIONS,
  MODEL_OPTIONS,
  ModelCacheStatus,
  ModelDownloadProgress,
  WhisperModelId,
} from '../types/transcribe';
import { formatDuration, formatFileSize } from '../utils/subtitleFormatter';

interface SidebarConfigProps {
  config: EngineConfig;
  onChangeConfig: (patch: Partial<EngineConfig>) => void;
  webgpuSupported: boolean | null;
  activeDeviceUsed: 'webgpu' | 'wasm' | null;
  cacheMap: Record<string, ModelCacheStatus>;
  downloadState: ModelDownloadProgress;
  onPreloadModel: () => void;
  onSelectLocalModelFolder: (files: FileList) => void;
  onClearLocalModelFolder: () => void;
  isOnline: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  stats: {
    totalFiles: number;
    completedFiles: number;
    totalDuration: number;
    totalCharacters: number;
  };
}

export const SidebarConfig: React.FC<SidebarConfigProps> = ({
  config,
  onChangeConfig,
  webgpuSupported,
  activeDeviceUsed,
  cacheMap,
  downloadState,
  onPreloadModel,
  onSelectLocalModelFolder,
  onClearLocalModelFolder,
  isOnline,
  theme,
  onToggleTheme,
  stats,
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectedModel = MODEL_OPTIONS.find((m) => m.id === config.modelId) ?? MODEL_OPTIONS[1];
  const cacheInfo = cacheMap[config.modelId];
  const isDownloadingThisModel =
    downloadState.status === 'downloading' && downloadState.modelId === config.modelId;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:w-[280px] lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex-1 space-y-6 p-5 overflow-y-auto">
        {/* Local Engine & Model Section */}
        <section aria-labelledby="engine-heading" className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h2
              id="engine-heading"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              本地识别引擎
            </h2>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>网络在线</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span className="text-amber-700 dark:text-amber-400">已断网运行</span>
                </>
              )}
            </span>
          </div>

          {/* Model Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="model-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Whisper 语音模型
            </label>
            <select
              id="model-select"
              value={config.modelId}
              disabled={Boolean(config.localModelLoadedName)}
              onChange={(e) => onChangeConfig({ modelId: e.target.value as WhisperModelId })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.sizeLabel}) {cacheMap[m.id]?.cached ? '· 已缓存' : ''}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span>速度：{selectedModel.speedLabel}</span>
              <span aria-hidden="true">·</span>
              <span>精度：{selectedModel.accuracyLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {cacheInfo?.cached
                  ? `已缓存 (${formatFileSize(cacheInfo.cachedBytes)})`
                  : '未缓存'}
              </span>
            </div>
          </div>

          {/* Model Cache / Local Folder Controls */}
          {config.localModelLoadedName ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">已挂载本地目录：{config.localModelLoadedName}</span>
              </div>
              <button
                type="button"
                onClick={onClearLocalModelFolder}
                className="mt-2 text-xs font-medium text-slate-600 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                切回标准缓存模型
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {isDownloadingThisModel ? (
                <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      正在缓存模型...
                    </span>
                    <span className="font-mono tabular-nums text-blue-700 dark:text-blue-400">
                      {downloadState.progress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full bg-blue-600 transition-transform duration-150"
                      style={{
                        width: '100%',
                        transform: `translateX(-${100 - downloadState.progress}%)`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    <span className="truncate max-w-[140px]">
                      {downloadState.currentFile || '初始化'}
                    </span>
                    <span>
                      {downloadState.totalBytes > 0
                        ? `${formatFileSize(downloadState.loadedBytes)} / ${formatFileSize(downloadState.totalBytes)}`
                        : '准备中'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onPreloadModel}
                    disabled={config.offlineOnly && !cacheInfo?.cached}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{cacheInfo?.cached ? '校验/载入' : '缓存离线用'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <FolderInput className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>本地模型包</span>
                  </button>
                </div>
              )}
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                // @ts-expect-error webkitdirectory is supported across Chromium/Firefox/Safari
                webkitdirectory=""
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onSelectLocalModelFolder(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          )}

          {/* Language & Task */}
          <div className="space-y-1.5">
            <label
              htmlFor="lang-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              媒体源语言
            </label>
            <select
              id="lang-select"
              value={config.language}
              onChange={(e) => onChangeConfig({ language: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              输出任务模式
            </span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onChangeConfig({ task: 'transcribe' })}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  config.task === 'transcribe'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                原语种转录
              </button>
              <button
                type="button"
                onClick={() => onChangeConfig({ task: 'translate' })}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  config.task === 'translate'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                译为英文
              </button>
            </div>
          </div>

          {/* Hardware Device */}
          <div className="space-y-1.5">
            <label
              htmlFor="device-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              本地计算后端
            </label>
            <select
              id="device-select"
              value={config.device}
              onChange={(e) =>
                onChangeConfig({ device: e.target.value as EngineConfig['device'] })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="auto">自动选择（优先 WebGPU）</option>
              <option value="webgpu" disabled={webgpuSupported === false}>
                WebGPU 显卡加速 {webgpuSupported === false ? '(当前不可用)' : ''}
              </option>
              <option value="wasm">WebAssembly (CPU 多线程)</option>
            </select>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {activeDeviceUsed
                  ? `当前激活：${activeDeviceUsed === 'webgpu' ? 'WebGPU' : 'WASM CPU'}`
                  : webgpuSupported
                    ? '检测到可用 WebGPU 适配器'
                    : '将使用本地 WASM 引擎'}
              </span>
            </div>
          </div>

          {/* Offline Only Toggle */}
          <div className="pt-1">
            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <div className="space-y-0.5">
                <span className="block text-xs font-medium text-slate-900 dark:text-slate-100">
                  严格离线模式
                </span>
                <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  禁止发起任何模型下载请求，仅使用本地缓存或已导入模型
                </span>
              </div>
              <input
                type="checkbox"
                checked={config.offlineOnly}
                onChange={(e) => onChangeConfig({ offlineOnly: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
            </label>
          </div>
        </section>

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Batch Summary Metrics */}
        <section aria-labelledby="summary-heading" className="space-y-3">
          <h2
            id="summary-heading"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            当前任务统计
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">队列总文件</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {stats.totalFiles} 项
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">已完成转录</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {stats.completedFiles} 项
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">媒体总时长</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatDuration(stats.totalDuration)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">识别总字数</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {stats.totalCharacters.toLocaleString()}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Sidebar Footer: Privacy Guarantee & Theme Switch */}
      <div className="border-t border-slate-200 p-4 space-y-3 dark:border-slate-800">
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>音视频均在本地内存解码与推理，绝不上传云端服务器。</span>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            <span>结果存至本地 IndexedDB</span>
          </span>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换至浅色模式' : '切换至深色模式'}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>浅色</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>深色</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
