import React, { useRef } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FolderInput,
  Moon,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  DownloadSource,
  InferenceDevice,
  LANGUAGE_OPTIONS,
  MODEL_OPTIONS,
  ModelCacheInfo,
  ModelDownloadState,
  SpeechConfig,
  WhisperModelId,
} from '../types/speech';
import { formatFileSize } from '../utils/textFormatter';

interface ConfigSidebarProps {
  config: SpeechConfig;
  onChangeConfig: (patch: Partial<SpeechConfig>) => void;
  webgpuSupported: boolean | null;
  activeDeviceUsed: 'webgpu' | 'wasm' | null;
  cacheMap: Record<string, ModelCacheInfo>;
  downloadState: ModelDownloadState;
  onPreloadModel: () => void;
  onSelectLocalModelFolder: (files: FileList) => void;
  onClearLocalModelFolder: () => void;
  isOnline: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const ConfigSidebar: React.FC<ConfigSidebarProps> = ({
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
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const selectedModel = MODEL_OPTIONS.find((m) => m.id === config.modelId) ?? MODEL_OPTIONS[1];
  const cacheInfo = cacheMap[config.modelId];
  const isDownloading =
    downloadState.status === 'downloading' && downloadState.modelId === config.modelId;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:w-[292px] lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            识别参数设置
          </h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>网络在线</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-amber-700 dark:text-amber-400">离线运行</span>
              </>
            )}
          </span>
        </div>

        {/* Model Selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="stt-model-select"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            本地 Whisper 模型
          </label>
          <select
            id="stt-model-select"
            value={config.modelId}
            disabled={Boolean(config.localModelName)}
            onChange={(e) => onChangeConfig({ modelId: e.target.value as WhisperModelId })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.sizeLabel}）{cacheMap[m.id]?.cached ? '· 已缓存' : ''}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>速度：{selectedModel.speedLabel}</span>
            <span aria-hidden="true">·</span>
            <span>精度：{selectedModel.accuracyLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {cacheInfo?.cached
                ? `已缓存 ${formatFileSize(cacheInfo.cachedBytes)}`
                : '未缓存'}
            </span>
          </div>
        </div>

        {/* Download Source / Mirror */}
        {!config.localModelName && (
          <div className="space-y-1.5">
            <label
              htmlFor="stt-mirror-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              首次下载源（缓存后无需联网）
            </label>
            <select
              id="stt-mirror-select"
              value={config.downloadSource}
              onChange={(e) =>
                onChangeConfig({ downloadSource: e.target.value as DownloadSource })
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="huggingface">HuggingFace 官方源</option>
              <option value="hf-mirror">国内镜像加速 (hf-mirror.com)</option>
              <option value="custom">自定义镜像地址</option>
            </select>
            {config.downloadSource === 'custom' && (
              <input
                type="url"
                value={config.customMirrorUrl}
                onChange={(e) => onChangeConfig({ customMirrorUrl: e.target.value })}
                placeholder="https://hf-mirror.com/"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            )}
          </div>
        )}

        {/* Model Cache & Local Folder */}
        {config.localModelName ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">本地模型：{config.localModelName}</span>
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
            {isDownloading ? (
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
                    {downloadState.currentFile || '连接中'}
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
                  <span>{cacheInfo?.cached ? '校验缓存' : '下载缓存'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FolderInput className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>本地文件夹</span>
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

        <hr className="border-slate-200 dark:border-slate-800" />

        {/* Language */}
        <div className="space-y-1.5">
          <label
            htmlFor="stt-lang-select"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            语音语种
          </label>
          <select
            id="stt-lang-select"
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

        {/* Hardware Backend */}
        <div className="space-y-1.5">
          <label
            htmlFor="stt-device-select"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            本地计算后端
          </label>
          <select
            id="stt-device-select"
            value={config.device}
            onChange={(e) => onChangeConfig({ device: e.target.value as InferenceDevice })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="auto">自动选择（失败自动降级 CPU）</option>
            <option value="wasm">CPU 多线程 (WASM · 最稳定)</option>
            <option value="webgpu" disabled={webgpuSupported === false}>
              WebGPU 显卡加速 {webgpuSupported === false ? '（不可用）' : ''}
            </option>
          </select>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {activeDeviceUsed
                ? `当前已激活：${activeDeviceUsed === 'webgpu' ? 'WebGPU' : 'WASM CPU'}`
                : webgpuSupported
                  ? '支持 WebGPU（可随时切回 WASM）'
                  : '将使用本地 WASM CPU 运行'}
            </span>
          </div>
        </div>

        {/* Strict Offline Mode */}
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
          <div className="space-y-0.5">
            <span className="block text-xs font-medium text-slate-900 dark:text-slate-100">
              严格离线模式
            </span>
            <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              禁止任何联网请求，仅用本地已缓存模型
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

      {/* Footer */}
      <div className="border-t border-slate-200 p-4 space-y-3 dark:border-slate-800">
        <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <ShieldCheck
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>所有音频解码与语音识别均在本地浏览器内完成，绝不上传至任何服务器。</span>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>切换浅色</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>切换深色</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
