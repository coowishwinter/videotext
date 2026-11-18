import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileAudio,
  FileText,
  FileVideo,
  FolderOpen,
  PackageCheck,
  Play,
  RotateCcw,
  Search,
  Square,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react';
import { MediaQueueItem, QueueItemStatus } from '../types/transcribe';
import { formatDuration, formatFileSize } from '../utils/subtitleFormatter';

interface BatchQueuePaneProps {
  items: MediaQueueItem[];
  selectedId: string | null;
  isBatchRunning: boolean;
  onSelectItem: (id: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onStartAll: () => void;
  onStopBatch: () => void;
  onTranscribeSingle: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearCompleted: () => void;
  onToggleSelectForExport: (id: string) => void;
  onToggleSelectAllForExport: (checked: boolean) => void;
  onExportSingleSrt: (item: MediaQueueItem) => void;
  onExportSingleTxt: (item: MediaQueueItem) => void;
  onBatchExportZip: (format: 'srt' | 'txt' | 'both') => void;
  onBatchExportMergedTxt: () => void;
  onRelinkFile: (id: string, file: File) => void;
}

type FilterTab = 'all' | 'pending' | 'processing' | 'completed' | 'error';

export const BatchQueuePane: React.FC<BatchQueuePaneProps> = ({
  items,
  selectedId,
  isBatchRunning,
  onSelectItem,
  onAddFiles,
  onStartAll,
  onStopBatch,
  onTranscribeSingle,
  onRemoveItem,
  onClearCompleted,
  onToggleSelectForExport,
  onToggleSelectAllForExport,
  onExportSingleSrt,
  onExportSingleTxt,
  onBatchExportZip,
  onBatchExportMergedTxt,
  onRelinkFile,
}) => {
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [relinkTargetId, setRelinkTargetId] = useState<string | null>(null);
  const folderPickerRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let error = 0;
    for (const item of items) {
      if (item.status === 'queued' || item.status === 'cancelled') pending++;
      else if (item.status === 'decoding' || item.status === 'transcribing') processing++;
      else if (item.status === 'completed') completed++;
      else if (item.status === 'error') error++;
    }
    return { all: items.length, pending, processing, completed, error };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.fileName.toLowerCase().includes(q)) return false;
      if (filterTab === 'pending') return item.status === 'queued' || item.status === 'cancelled';
      if (filterTab === 'processing')
        return item.status === 'decoding' || item.status === 'transcribing';
      if (filterTab === 'completed') return item.status === 'completed';
      if (filterTab === 'error') return item.status === 'error';
      return true;
    });
  }, [items, filterTab, searchQuery]);

  const completedItems = items.filter((i) => i.status === 'completed');
  const selectedExportCount = completedItems.filter((i) => i.selectedForExport).length;
  const allCompletedSelected =
    completedItems.length > 0 && selectedExportCount === completedItems.length;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const renderStatusText = (status: QueueItemStatus, item: MediaQueueItem) => {
    switch (status) {
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>等待转录</span>
          </span>
        );
      case 'decoding':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400">
            <span>提取音轨中...</span>
          </span>
        );
      case 'transcribing':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 tabular-nums dark:text-blue-400">
            <span>{item.stageText || `识别中 ${item.progress}%`}</span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{item.isHistoryOnly ? '本地历史记录' : '已完成'}</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <span>已暂停</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>处理失败</span>
          </span>
        );
    }
  };

  return (
    <section
      aria-label="批量媒体队列"
      className="flex flex-col border-b border-slate-200 bg-white lg:w-[48%] lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Hidden inputs for files and folder batch selection */}
      <input
        ref={filePickerRef}
        type="file"
        multiple
        accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.opus"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAddFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderPickerRef}
        type="file"
        // @ts-expect-error webkitdirectory allows selecting an entire folder of media files offline
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAddFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={relinkInputRef}
        type="file"
        accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.opus"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked && relinkTargetId) {
            onRelinkFile(relinkTargetId, picked);
          }
          setRelinkTargetId(null);
          e.target.value = '';
        }}
      />

      {/* Dropzone Header */}
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3.5 transition-colors sm:flex-row ${
            isDragOver
              ? 'border-blue-600 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/30'
              : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Upload className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                拖拽多个视频或音频文件到此处
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                支持 MP4 · MOV · WebM · MKV · MP3 · WAV · M4A · FLAC · OGG
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => filePickerRef.current?.click()}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={() => folderPickerRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>导入文件夹</span>
            </button>
          </div>
        </div>

        {/* Batch Control Bar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!isBatchRunning ? (
              <button
                type="button"
                onClick={onStartAll}
                disabled={counts.pending + counts.error === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  开始批量转录{counts.pending > 0 ? ` (${counts.pending})` : ''}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStopBatch}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 whitespace-nowrap"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                <span>停止处理</span>
              </button>
            )}

            {completedItems.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onBatchExportZip('both')}
                  disabled={selectedExportCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>批量导出 ZIP ({selectedExportCount})</span>
                </button>
                <button
                  type="button"
                  onClick={onBatchExportMergedTxt}
                  disabled={selectedExportCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>合并 TXT</span>
                </button>
              </>
            )}
          </div>

          {counts.completed > 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap dark:text-slate-400 dark:hover:text-slate-200"
            >
              清除已完成
            </button>
          )}
        </div>

        {/* Filter Tabs + Search */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {(
              [
                { id: 'all', label: `全部 ${counts.all}` },
                { id: 'pending', label: `待处理 ${counts.pending}` },
                { id: 'processing', label: `进行中 ${counts.processing}` },
                { id: 'completed', label: `已完成 ${counts.completed}` },
                ...(counts.error > 0 ? [{ id: 'error' as const, label: `失败 ${counts.error}` }] : []),
              ] as Array<{ id: FilterTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                  filterTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[160px] flex-1 sm:max-w-[200px]">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文件名..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {/* Batch Selection Header when completed items exist */}
      {completedItems.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-1.5 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allCompletedSelected}
              onChange={(e) => onToggleSelectAllForExport(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>全选已完成文件用于批量导出</span>
          </label>
          <span className="tabular-nums">
            已勾选 {selectedExportCount} / {completedItems.length}
          </span>
        </div>
      )}

      {/* Queue Items List */}
      <div className="flex-1 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
        {filteredItems.length === 0 ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
            <FileAudio className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              {items.length === 0 ? '尚未添加音视频文件' : '当前筛选条件下没有匹配文件'}
            </p>
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
              {items.length === 0
                ? '拖拽视频或音频文件到上方区域，或点击「导入文件夹」一次性加入整个目录的媒体文件。'
                : '切换筛选标签或清除文件名关键词即可查看其他文件。'}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = item.id === selectedId;
            const isProcessing = item.status === 'decoding' || item.status === 'transcribing';

            return (
              <div
                key={item.id}
                onClick={() => onSelectItem(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item.id);
                  }
                }}
                className={`group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                  isSelected
                    ? 'bg-blue-50/70 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                {/* Export checkbox for completed items */}
                <div
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.status === 'completed' ? (
                    <input
                      type="checkbox"
                      checked={item.selectedForExport}
                      onChange={() => onToggleSelectForExport(item.id)}
                      aria-label={`勾选导出 ${item.fileName}`}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center text-slate-400">
                      {item.fileType === 'video' ? (
                        <FileVideo className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <FileAudio className="h-4 w-4" aria-hidden="true" />
                      )}
                    </div>
                  )}
                </div>

                {/* Main info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.fileName}
                    </p>
                    <div className="shrink-0">{renderStatusText(item.status, item)}</div>
                  </div>

                  {/* Unboxed Metadata Line */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    <span>{item.fileType === 'video' ? '视频' : '音频'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatFileSize(item.fileSize)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.duration > 0 ? formatDuration(item.duration) : '--:--'}</span>
                    {item.status === 'completed' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{item.chunks.length} 条字幕</span>
                      </>
                    )}
                  </div>

                  {/* Progress bar during decoding/transcribing */}
                  {isProcessing && (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full bg-blue-600 transition-transform duration-150"
                        style={{
                          width: '100%',
                          transform: `translateX(-${100 - item.progress}%)`,
                        }}
                      />
                    </div>
                  )}

                  {item.status === 'error' && item.errorMessage && (
                    <p className="mt-1 truncate text-[11px] text-red-600 dark:text-red-400">
                      {item.errorMessage}
                    </p>
                  )}
                </div>

                {/* Row Quick Actions */}
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.status === 'error' && (
                    <button
                      type="button"
                      title="重新选择本地文件"
                      onClick={() => {
                        setRelinkTargetId(item.id);
                        relinkInputRef.current?.click();
                      }}
                      disabled={isBatchRunning}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      重选文件
                    </button>
                  )}

                  {(item.status === 'queued' ||
                    item.status === 'error' ||
                    item.status === 'cancelled') &&
                    item.file && (
                      <button
                        type="button"
                        title="立即转录此文件"
                        aria-label={`转录 ${item.fileName}`}
                        onClick={() => onTranscribeSingle(item.id)}
                        disabled={isBatchRunning}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-blue-700 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-400"
                      >
                        {item.status === 'error' ? (
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    )}

                  {item.status === 'completed' && (
                    <>
                      <button
                        type="button"
                        title="导出 SRT 字幕"
                        aria-label={`导出 ${item.fileName} SRT`}
                        onClick={() => onExportSingleSrt(item)}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                      >
                        <Subtitles className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title="导出 TXT 文稿"
                        aria-label={`导出 ${item.fileName} TXT`}
                        onClick={() => onExportSingleTxt(item)}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    title="移除"
                    aria-label={`移除 ${item.fileName}`}
                    onClick={() => onRemoveItem(item.id)}
                    className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
