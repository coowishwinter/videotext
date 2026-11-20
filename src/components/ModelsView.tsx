import React, { useRef } from 'react';
import { CheckCircle2, Download, FolderInput, Trash2 } from 'lucide-react';
import {
  MODEL_OPTIONS,
  ModelCacheInfo,
  ModelDownloadState,
  SpeechConfig,
  WhisperModelId,
} from '../types/speech';
import { formatFileSize } from '../utils/textFormatter';

interface ModelsViewProps {
  config: SpeechConfig;
  onChangeConfig: (patch: Partial<SpeechConfig>) => void;
  cacheMap: Record<string, ModelCacheInfo>;
  downloadState: ModelDownloadState;
  onPreloadModel: (id: WhisperModelId) => void;
  onDeleteModelCache: (id: WhisperModelId) => void;
  onSelectLocalModelFolder: (files: FileList) => void;
  onClearLocalModelFolder: () => void;
}

export const ModelsView: React.FC<ModelsViewProps> = ({
  config,
  onChangeConfig,
  cacheMap,
  downloadState,
  onPreloadModel,
  onDeleteModelCache,
  onSelectLocalModelFolder,
  onClearLocalModelFolder,
}) => {
  const folderRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          本地离线模型库
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          模型首次缓存到浏览器后即可断网使用。如果访问 HuggingFace 较慢，可切换至国内镜像源或导入本地模型文件夹。
        </p>
      </div>

      {/* Model Cards */}
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {MODEL_OPTIONS.map((model) => {
          const cache = cacheMap[model.id];
          const isCurrent = config.modelId === model.id;
          const isDownloading =
            downloadState.status === 'downloading' && downloadState.modelId === model.id;

          return (
            <div
              key={model.id}
              className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {model.name}
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {model.sizeLabel} · 速度：{model.speedLabel} · 精度：{model.accuracyLabel}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {model.description}
                </p>
                <p className="text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
                  {cache?.cached
                    ? `已离线缓存 (${formatFileSize(cache.cachedBytes)} · ${cache.fileCount} 个文件)`
                    : '尚未缓存到本地'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => onChangeConfig({ modelId: model.id })}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    设为当前模型
                  </button>
                )}
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 px-2">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>当前使用</span>
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onPreloadModel(model.id)}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isDownloading
                      ? `${downloadState.progress}%`
                      : cache?.cached
                        ? '校验缓存'
                        : '下载缓存'}
                  </span>
                </button>

                {cache?.cached && (
                  <button
                    type="button"
                    onClick={() => onDeleteModelCache(model.id)}
                    aria-label={`清除 ${model.name} 缓存`}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-red-300 hover:text-red-600 dark:border-slate-700 dark:text-slate-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Offline Local Folder Mount */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              从硬盘文件夹导入离线 Whisper ONNX 模型
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              适合完全无法联网的内网环境。目录需包含 config.json、tokenizer.json 与 onnx/*.onnx 权重文件。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {config.localModelName && (
              <button
                type="button"
                onClick={onClearLocalModelFolder}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
              >
                卸载本地目录
              </button>
            )}
            <button
              type="button"
              onClick={() => folderRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
              <span>选择模型文件夹</span>
            </button>
          </div>
        </div>
        <input
          ref={folderRef}
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
    </div>
  );
};
