import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  Merge,
  Plus,
  Subtitles,
  Trash2,
} from 'lucide-react';
import { ExportSettings, MediaQueueItem, SubtitleChunk } from '../types/transcribe';
import {
  formatDuration,
  formatSrtTimestamp,
  generateSrt,
  generateTxt,
  parseSrtTimestamp,
} from '../utils/subtitleFormatter';

interface TranscriptInspectorProps {
  item: MediaQueueItem | null;
  exportSettings: ExportSettings;
  onChangeExportSettings: (patch: Partial<ExportSettings>) => void;
  onUpdateChunks: (itemId: string, nextChunks: SubtitleChunk[]) => void;
  onExportSrt: (item: MediaQueueItem) => void;
  onExportTxt: (item: MediaQueueItem) => void;
}

type InspectorViewMode = 'cues' | 'txt' | 'srt_raw';

export const TranscriptInspector: React.FC<TranscriptInspectorProps> = ({
  item,
  exportSettings,
  onChangeExportSettings,
  onUpdateChunks,
  onExportSrt,
  onExportTxt,
}) => {
  const [viewMode, setViewMode] = useState<InspectorViewMode>('cues');
  const [currentTime, setCurrentTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editingTsId, setEditingTsId] = useState<string | null>(null);
  const [tsDraft, setTsDraft] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    setCurrentTime(0);
    setEditingTsId(null);
  }, [item?.id]);

  const srtPreview = useMemo(() => {
    if (!item) return '';
    return generateSrt(item.chunks, { maxLineChars: exportSettings.srtMaxLineChars });
  }, [item, exportSettings.srtMaxLineChars]);

  const txtPreview = useMemo(() => {
    if (!item) return '';
    return generateTxt(item.chunks, item.fullText, {
      mode: exportSettings.txtMode,
      title: exportSettings.txtIncludeTitle ? item.fileName : undefined,
    });
  }, [item, exportSettings.txtMode, exportSettings.txtIncludeTitle]);

  const activeCueId = useMemo(() => {
    if (!item || item.chunks.length === 0) return null;
    const hit = item.chunks.find(
      (c) => currentTime >= c.start && currentTime <= c.end + 0.05
    );
    return hit?.id ?? null;
  }, [item, currentTime]);

  const seekToTime = (seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    el.play().catch(() => {});
  };

  const handleCopy = async () => {
    if (!item) return;
    const content = viewMode === 'srt_raw' ? srtPreview : txtPreview;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleTextChange = (chunkId: string, newText: string) => {
    if (!item) return;
    const next = item.chunks.map((c) => (c.id === chunkId ? { ...c, text: newText } : c));
    onUpdateChunks(item.id, next);
  };

  const handleMergeWithNext = (index: number) => {
    if (!item || index >= item.chunks.length - 1) return;
    const current = item.chunks[index];
    const next = item.chunks[index + 1];
    const merged: SubtitleChunk = {
      id: current.id,
      start: current.start,
      end: Math.max(current.end, next.end),
      text: `${current.text.trim()} ${next.text.trim()}`.trim(),
    };
    const updated = [
      ...item.chunks.slice(0, index),
      merged,
      ...item.chunks.slice(index + 2),
    ];
    onUpdateChunks(item.id, updated);
  };

  const handleDeleteChunk = (chunkId: string) => {
    if (!item) return;
    onUpdateChunks(
      item.id,
      item.chunks.filter((c) => c.id !== chunkId)
    );
  };

  const handleAddChunkAtEnd = () => {
    if (!item) return;
    const lastEnd = item.chunks.length > 0 ? item.chunks[item.chunks.length - 1].end : 0;
    const nextChunk: SubtitleChunk = {
      id: `manual-${Date.now()}`,
      start: lastEnd,
      end: lastEnd + 3,
      text: '新增字幕内容',
    };
    onUpdateChunks(item.id, [...item.chunks, nextChunk]);
  };

  const beginEditTimestamp = (chunk: SubtitleChunk) => {
    setEditingTsId(chunk.id);
    setTsDraft({
      start: formatSrtTimestamp(chunk.start),
      end: formatSrtTimestamp(chunk.end),
    });
  };

  const commitEditTimestamp = (chunkId: string) => {
    if (!item) return;
    const startSec = parseSrtTimestamp(tsDraft.start);
    const endSec = parseSrtTimestamp(tsDraft.end);
    if (startSec !== null && endSec !== null && endSec > startSec) {
      const next = item.chunks.map((c) =>
        c.id === chunkId ? { ...c, start: startSec, end: endSec } : c
      );
      onUpdateChunks(item.id, next);
    }
    setEditingTsId(null);
  };

  if (!item) {
    return (
      <section
        aria-label="字幕审校与导出预览"
        className="flex flex-1 flex-col items-center justify-center bg-slate-50/50 p-8 text-center dark:bg-slate-950/40"
      >
        <Subtitles className="h-9 w-9 text-slate-300 dark:text-slate-600" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          未选择媒体文件
        </h3>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          在左侧队列中点击任意音视频文件，即可预览波形/画面、实时查看识别进展、校对时间轴字幕并导出 SRT 或 TXT。
        </p>
      </section>
    );
  }

  const isProcessing = item.status === 'decoding' || item.status === 'transcribing';

  return (
    <section
      aria-label="字幕审校与导出预览"
      className="flex flex-1 flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30"
    >
      {/* Inspector Header & Export Bar */}
      <div className="border-b border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {item.fileName}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
              <span>{item.fileType === 'video' ? '视频文件' : '音频文件'}</span>
              <span aria-hidden="true">·</span>
              <span>时长 {item.duration > 0 ? formatDuration(item.duration) : '--:--'}</span>
              {item.modelUsed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>模型 {item.modelUsed.split('/').pop()}</span>
                </>
              )}
              {item.elapsedMs && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>耗时 {(item.elapsedMs / 1000).toFixed(1)}s</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              disabled={item.chunks.length === 0 && !item.fullText}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>复制文本</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onExportTxt(item)}
              disabled={item.status !== 'completed'}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>导出 TXT</span>
            </button>
            <button
              type="button"
              onClick={() => onExportSrt(item)}
              disabled={item.status !== 'completed'}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-45 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>导出 SRT</span>
            </button>
          </div>
        </div>

        {/* Local Media Preview Player */}
        {item.objectUrl && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
            {item.fileType === 'video' ? (
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                src={item.objectUrl}
                controls
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="max-h-48 w-full object-contain bg-black"
              />
            ) : (
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={item.objectUrl}
                controls
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                className="w-full bg-slate-100 dark:bg-slate-800"
              />
            )}
          </div>
        )}

        {/* View Mode Tabs + Inline Export Format Switches */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('cues')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'cues'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              时间轴校对 ({item.chunks.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('txt')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'txt'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              TXT 纯文本
            </button>
            <button
              type="button"
              onClick={() => setViewMode('srt_raw')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'srt_raw'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              SRT 源码
            </button>
          </div>

          {viewMode === 'txt' && (
            <select
              aria-label="TXT 排版格式"
              value={exportSettings.txtMode}
              onChange={(e) =>
                onChangeExportSettings({
                  txtMode: e.target.value as ExportSettings['txtMode'],
                })
              }
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="lines">按字幕分段换行</option>
              <option value="continuous">合并为连续段落</option>
              <option value="timestamped">每行附加时间戳</option>
            </select>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-5">
        {isProcessing && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-slate-900 dark:text-slate-100">
                {item.stageText || '正在本地识别中...'}
              </span>
              <span className="font-mono tabular-nums text-blue-700 dark:text-blue-400">
                {item.progress}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-blue-600 transition-transform duration-150"
                style={{
                  width: '100%',
                  transform: `translateX(-${100 - item.progress}%)`,
                }}
              />
            </div>
            {item.chunks.length > 0 ? (
              <div className="space-y-1.5 pt-2">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  已识别字幕片段（实时更新中）：
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
                  {item.chunks.map((ch) => (
                    <div key={ch.id} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-blue-700 dark:text-blue-400">
                        {formatSrtTimestamp(ch.start).slice(0, 8)}
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">{ch.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              item.streamingText && (
                <div className="pt-2">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    实时处理状态：
                  </p>
                  <p className="mt-1 rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {item.streamingText}
                  </p>
                </div>
              )
            )}
          </div>
        )}

        {!isProcessing && item.status !== 'completed' && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {item.status === 'error'
                ? item.errorMessage || '处理出错，请检查文件格式或重新尝试。'
                : '该文件正在等待转录，点击左侧队列的播放按钮或「开始批量转录」即可在本地开始识别。'}
            </p>
          </div>
        )}

        {item.status === 'completed' && viewMode === 'cues' && (
          <div className="space-y-2">
            {item.chunks.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                未检测到语音内容（可能是纯音乐或静音文件）。
              </div>
            ) : (
              item.chunks.map((chunk, idx) => {
                const isActiveCue = activeCueId === chunk.id;
                const isEditingTs = editingTsId === chunk.id;

                return (
                  <div
                    key={chunk.id}
                    className={`rounded-lg border bg-white p-3 transition-colors dark:bg-slate-900 ${
                      isActiveCue
                        ? 'border-blue-600 ring-1 ring-blue-600/20 dark:border-blue-500'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-400">
                          #{String(idx + 1).padStart(2, '0')}
                        </span>

                        {isEditingTs ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={tsDraft.start}
                              onChange={(e) =>
                                setTsDraft((d) => ({ ...d, start: e.target.value }))
                              }
                              className="w-28 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] tabular-nums dark:border-slate-600 dark:bg-slate-800"
                            />
                            <span className="text-[11px] text-slate-400">--&gt;</span>
                            <input
                              type="text"
                              value={tsDraft.end}
                              onChange={(e) =>
                                setTsDraft((d) => ({ ...d, end: e.target.value }))
                              }
                              className="w-28 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] tabular-nums dark:border-slate-600 dark:bg-slate-800"
                            />
                            <button
                              type="button"
                              onClick={() => commitEditTimestamp(chunk.id)}
                              className="rounded bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-700"
                            >
                              保存
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => seekToTime(chunk.start)}
                              title="点击跳转到该时间点播放"
                              className="font-mono text-[11px] font-medium tabular-nums text-blue-700 hover:underline dark:text-blue-400"
                            >
                              {formatSrtTimestamp(chunk.start)} --&gt;{' '}
                              {formatSrtTimestamp(chunk.end)}
                            </button>
                            <button
                              type="button"
                              onClick={() => beginEditTimestamp(chunk)}
                              className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            >
                              修改时间
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {idx < item.chunks.length - 1 && (
                          <button
                            type="button"
                            title="与下一条合并"
                            onClick={() => handleMergeWithNext(idx)}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Merge className="h-3 w-3" aria-hidden="true" />
                            <span>合并</span>
                          </button>
                        )}
                        <button
                          type="button"
                          title="删除此条字幕"
                          aria-label="删除此条字幕"
                          onClick={() => handleDeleteChunk(chunk.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={chunk.text}
                      rows={Math.max(1, Math.ceil(chunk.text.length / 42))}
                      onChange={(e) => handleTextChange(chunk.id, e.target.value)}
                      className="mt-2 w-full resize-none rounded border border-transparent bg-slate-50/70 px-2.5 py-1.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:bg-slate-800/50 dark:text-slate-100 dark:focus:bg-slate-800"
                    />
                  </div>
                );
              })
            )}

            <button
              type="button"
              onClick={handleAddChunkAtEnd}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>末尾追加字幕条</span>
            </button>
          </div>
        )}

        {item.status === 'completed' && viewMode === 'txt' && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-slate-800 dark:text-slate-200">
              {txtPreview || '暂无文本内容'}
            </pre>
          </div>
        )}

        {item.status === 'completed' && viewMode === 'srt_raw' && (
          <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-6 tabular-nums text-slate-800 dark:text-slate-200">
              {srtPreview || '暂无 SRT 字幕内容'}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
};
