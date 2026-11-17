import React, { useRef } from 'react';
import {
  CheckCircle2,
  Download,
  FolderInput,
  HardDrive,
  Trash2,
} from 'lucide-react';
import {
  EngineConfig,
  MODEL_OPTIONS,
  ModelCacheStatus,
  ModelDownloadProgress,
  WhisperModelId,
} from '../types/transcribe';
import { formatFileSize } from '../utils/subtitleFormatter';

interface ModelsManagerViewProps {
  config: EngineConfig;
  onChangeConfig: (patch: Partial<EngineConfig>) => void;
  cacheMap: Record<string, ModelCacheStatus>;
  downloadState: ModelDownloadProgress;
  onPreloadSpecificModel: (modelId: WhisperModelId) => void;
  onDeleteModelCache: (modelId: WhisperModelId) => void;
  onSelectLocalModelFolder: (files: FileList) => void;
  onClearLocalModelFolder: () => void;
}

const MIRROR_PRESETS = [
  { label: 'Hugging Face 官方源', url: 'https://huggingface.co/' },
  { label: 'HF-Mirror 国内加速镜像', url: 'https://hf-mirror.com/' },
];

export const ModelsManagerView: React.FC<ModelsManagerViewProps> = ({
  config,
  onChangeConfig,
  cacheMap,
  downloadState,
  onPreloadSpecificModel,
  onDeleteModelCache,
  onSelectLocalModelFolder,
  onClearLocalModelFolder,
}) => {
  const folderInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          离线模型库与本地缓存管理
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          模型首次缓存到浏览器的 Cache Storage 后，即使彻底断开网络也能持续进行本地语音识别。
        </p>
      </div>

      {/* Download Source & Air-gapped Local Folder Import */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            模型下载源设置
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            如果下载模型权重速度较慢，可切换至镜像源或填入局域网内自建模型镜像地址。
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {MIRROR_PRESETS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => onChangeConfig({ remoteHost: preset.url })}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    config.remoteHost === preset.url
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="url"
              value={config.remoteHost}
              onChange={(e) => onChangeConfig({ remoteHost: e.target.value })}
              placeholder="https://huggingface.co/"
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            物理断网导入本地 ONNX 模型包
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            在完全无互联网的内网环境下，您可以直接选择本地磁盘中已准备好的 Whisper ONNX 文件夹（包含 config.json、tokenizer.json 与 onnx/*.onnx）。
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
            >
              <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
              <span>选择本地模型文件夹</span>
            </button>

            {config.localModelLoadedName && (
              <button
                type="button"
                onClick={onClearLocalModelFolder}
                className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                卸载当前本地目录 ({config.localModelLoadedName})
              </button>
            )}
          </div>
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error webkitdirectory supported for local folder selection
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
      </div>

      {/* Whisper Models Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">模型名称</th>
              <th className="px-4 py-3 font-semibold">量化体积</th>
              <th className="px-4 py-3 font-semibold">速度 / 精度</th>
              <th className="px-4 py-3 font-semibold">离线缓存状态</th>
              <th className="px-4 py-3 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {MODEL_OPTIONS.map((model) => {
              const cache = cacheMap[model.id];
              const isSelected = config.modelId === model.id;
              const isDownloading =
                downloadState.status === 'downloading' && downloadState.modelId === model.id;

              return (
                <tr key={model.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {model.name}
                      {model.recommended && (
                        <span className="ml-2 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                          推荐默认
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {model.description}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {model.sizeLabel}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                    {model.speedLabel} · {model.accuracyLabel}
                  </td>
                  <td className="px-4 py-3.5">
                    {isDownloading ? (
                      <div className="w-36 space-y-1">
                        <div className="flex justify-between font-mono text-[11px] tabular-nums text-blue-700 dark:text-blue-400">
                          <span>下载中</span>
                          <span>{downloadState.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className="h-full bg-blue-600"
                            style={{
                              width: '100%',
                              transform: `translateX(-${100 - downloadState.progress}%)`,
                            }}
                          />
                        </div>
                      </div>
                    ) : cache?.cached ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>已缓存 ({formatFileSize(cache.cachedBytes)})</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>未缓存</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onChangeConfig({ modelId: model.id })}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                      >
                        {isSelected ? '当前选用' : '设为默认'}
                      </button>

                      <button
                        type="button"
                        disabled={isDownloading || (config.offlineOnly && !cache?.cached)}
                        onClick={() => onPreloadSpecificModel(model.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap dark:bg-slate-700 dark:hover:bg-slate-600"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        <span>{cache?.cached ? '预热载入' : '下载缓存'}</span>
                      </button>

                      {cache?.cached && (
                        <button
                          type="button"
                          title="清理该模型本地缓存"
                          onClick={() => onDeleteModelCache(model.id)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
