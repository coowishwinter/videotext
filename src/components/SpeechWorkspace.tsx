import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Download,
  FileAudio,
  FileVideo,
  Languages,
  Mic,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { PipelineStep, TranscriptJob } from '../types/speech';
import {
  formatDuration,
  formatFileSize,
  formatSegmentsText,
} from '../utils/textFormatter';

interface SpeechWorkspaceProps {
  jobs: TranscriptJob[];
  activeJob: TranscriptJob | null;
  isProcessing: boolean;
  onSelectJob: (id: string) => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRelinkFile: (id: string, file: File) => void;
  onStartTranscribe: (id: string, forceRestart?: boolean) => void;
  onStopTranscribe: () => void;
  onDiscardCheckpoint: (id: string) => void;
  onRetryWithMirror: (id: string) => void;
  onRetryWithWasm: (id: string) => void;
  onUpdateText: (id: string, nextText: string) => void;
  onConvertSimplified: (id: string) => void;
  onExportTxt: (job: TranscriptJob, includeTimestamps: boolean) => void;
  onRemoveJob: (id: string) => void;
  onOpenGuide: () => void;
}

const STEP_LABELS: Array<{ key: PipelineStep; label: string }> = [
  { key: 'decoding', label: '01. 读取并提取音频' },
  { key: 'loading-model', label: '02. 载入本地模型' },
  { key: 'transcribing', label: '03. 本地语音转文字' },
];

function getStepOrder(step: PipelineStep): number {
  if (step === 'decoding') return 0;
  if (step === 'loading-model') return 1;
  if (step === 'transcribing') return 2;
  if (step === 'done') return 3;
  return -1;
}

export const SpeechWorkspace: React.FC<SpeechWorkspaceProps> = ({
  jobs,
  activeJob,
  isProcessing,
  onSelectJob,
  onAddFiles,
  onRelinkFile,
  onStartTranscribe,
  onStopTranscribe,
  onDiscardCheckpoint,
  onRetryWithMirror,
  onRetryWithWasm,
  onUpdateText,
  onConvertSimplified,
  onExportTxt,
  onRemoveJob,
  onOpenGuide,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleToggleRecording = async () => {
    setMicError(null);
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('当前浏览器不支持麦克风录音，请直接导入本地音频或视频文件。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size > 0) {
          const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
          const recordedFile = new File([blob], `麦克风录音_${stamp}.webm`, {
            type: blob.type,
          });
          onAddFiles([recordedFile]);
        }
      };

      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setMicError('无法访问麦克风，请检查浏览器权限设置，或直接导入本地音视频文件。');
    }
  };

  const displayedText = activeJob
    ? activeJob.status === 'processing'
      ? [
          formatSegmentsText(activeJob.segments, '', includeTimestamps),
          activeJob.liveText,
        ]
          .filter(Boolean)
          .join(activeJob.segments.length > 0 ? '\n' : '')
      : activeJob.segments.length > 0 && (includeTimestamps || !activeJob.fullText)
        ? formatSegmentsText(activeJob.segments, activeJob.fullText, includeTimestamps)
        : activeJob.fullText
    : '';

  const charCount = displayedText.replace(/\s+/g, '').length;

  const handleCopy = async () => {
    if (!displayedText) return;
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const currentStepOrder = activeJob ? getStepOrder(activeJob.step) : -1;

  return (
    <section
      aria-label="语音转文字工作区"
      className="flex flex-1 flex-col overflow-y-auto bg-slate-50 p-6 dark:bg-slate-950"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
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
        ref={relinkInputRef}
        type="file"
        accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.flac,.ogg,.aac,.opus"
        className="hidden"
        onChange={(e) => {
          if (activeJob && e.target.files && e.target.files[0]) {
            onRelinkFile(activeJob.id, e.target.files[0]);
            e.target.value = '';
          }
        }}
      />

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
        {/* History / File Switcher Strip when multiple items exist */}
        {jobs.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {jobs.map((job) => {
              const isSelected = activeJob?.id === job.id;
              return (
                <div
                  key={job.id}
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-white font-semibold text-slate-900 dark:border-blue-500 dark:bg-slate-900 dark:text-slate-100'
                      : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:bg-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectJob(job.id)}
                    className="max-w-[200px] truncate text-left"
                  >
                    {job.fileName}
                    {job.status === 'interrupted' ? ` · 断点 ${job.progress}%` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveJob(job.id)}
                    aria-label={`移除 ${job.fileName}`}
                    className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State / Dropzone + Quick Usage Guide */}
        {!activeJob ? (
          <div className="flex flex-1 flex-col gap-5">
            <div
              className={`flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/20'
                  : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              <h1 className="text-xl font-semibold text-slate-900 text-balance dark:text-slate-100">
                本地音视频语音转文字
              </h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                拖拽音频或视频文件到此处，或使用麦克风现场录音。所有音轨解码与 Whisper 识别均在您的浏览器本地完成，支持简体中文自动转换且绝不上传云端。
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
                >
                  <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>选择音视频文件</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleRecording}
                  className={`inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                    isRecording
                      ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums">停止录音 ({formatDuration(recordSeconds)})</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>麦克风录音测试</span>
                    </>
                  )}
                </button>
              </div>

              {micError && (
                <p className="mt-4 text-xs text-red-600 dark:text-red-400">{micError}</p>
              )}

              <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
                支持格式：MP3（流式大文件解码）· WAV · M4A · FLAC · OGG · WebM · MP4 · MOV
              </p>
            </div>

            {/* Inline Quick Usage Guide */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  快速使用说明
                </h2>
                <button
                  type="button"
                  onClick={onOpenGuide}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>查看完整说明与排障</span>
                </button>
              </div>
              <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    01. 选择模型与国内镜像
                  </p>
                  <p className="leading-relaxed text-slate-500 dark:text-slate-400">
                    左侧默认使用 Whisper Base 与「简体中文（自动繁转简）」。若无法连上 HuggingFace，请将下载源改为「国内镜像加速」。
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    02. 首次缓存后即可断网
                  </p>
                  <p className="leading-relaxed text-slate-500 dark:text-slate-400">
                    模型首次缓存进浏览器后，可勾选「严格离线模式」完全断网运行，也可直接导入硬盘上的本地模型文件夹。
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    03. 流式解码与文本导出
                  </p>
                  <p className="leading-relaxed text-slate-500 dark:text-slate-400">
                    MP3 文件支持 2MB 分片流式解码（支持 150MB+ 长录音）；转写完成后支持编辑、一键转简体、复制或导出 TXT。
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Active File Control Card */}
            <div
              className={`rounded-xl border bg-white p-5 dark:bg-slate-900 ${
                isDragging
                  ? 'border-blue-500 ring-2 ring-blue-500/20'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {activeJob.mediaKind === 'video' ? (
                      <FileVideo className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    ) : (
                      <FileAudio className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                    )}
                    <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                      {activeJob.fileName}
                    </h1>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    <span>{activeJob.mediaKind === 'video' ? '视频文件' : '音频文件'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatFileSize(activeJob.fileSize)}</span>
                    {activeJob.duration > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>时长 {formatDuration(activeJob.duration)}</span>
                      </>
                    )}
                    {activeJob.deviceUsed && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {activeJob.deviceUsed === 'webgpu' ? 'WebGPU 加速' : 'WASM CPU'}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleRecording}
                    disabled={isProcessing}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-50 ${
                      isRecording
                        ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="tabular-nums">停止 ({formatDuration(recordSeconds)})</span>
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>录一段语音</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => relinkInputRef.current?.click()}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>换个文件</span>
                  </button>

                  {activeJob.status === 'processing' ? (
                    <button
                      type="button"
                      onClick={onStopTranscribe}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 whitespace-nowrap"
                    >
                      <Square className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>暂停并保存进度</span>
                    </button>
                  ) : activeJob.hasCheckpoint && activeJob.status !== 'completed' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onStartTranscribe(activeJob.id, false)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                      >
                        <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>继续转写 ({activeJob.progress}%)</span>
                      </button>
                      {activeJob.file && (
                        <button
                          type="button"
                          onClick={() => onStartTranscribe(activeJob.id, true)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <span>从头重转</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDiscardCheckpoint(activeJob.id)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <span>清除断点</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartTranscribe(activeJob.id, false)}
                      disabled={!activeJob.file || isProcessing}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {activeJob.status === 'completed'
                          ? '重新转文字'
                          : activeJob.file
                            ? '开始语音转文字'
                            : '请重新选择原文件'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {micError && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{micError}</p>
              )}

              {/* Inline Audio/Video Playback Preview */}
              {activeJob.objectUrl && (
                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                  {activeJob.mediaKind === 'video' ? (
                    <video
                      src={activeJob.objectUrl}
                      controls
                      preload="metadata"
                      className="max-h-56 w-full rounded-lg bg-slate-950"
                    />
                  ) : (
                    <audio
                      src={activeJob.objectUrl}
                      controls
                      preload="metadata"
                      className="h-10 w-full"
                    />
                  )}
                </div>
              )}

              {/* 3-Step Pipeline Status (visible when processing, interrupted, or error) */}
              {(activeJob.status === 'processing' ||
                activeJob.status === 'interrupted' ||
                activeJob.status === 'error') && (
                <div className="mt-4 border-t border-slate-100 pt-4 space-y-3 dark:border-slate-800">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {STEP_LABELS.map((stepObj, i) => {
                      const isDone = currentStepOrder > i;
                      const isCurrent =
                        activeJob.status === 'processing' && currentStepOrder === i;
                      return (
                        <div
                          key={stepObj.key}
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            isCurrent
                              ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-800 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300'
                              : isDone
                                ? 'border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
                                : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500'
                          }`}
                        >
                          {stepObj.label}
                        </div>
                      );
                    })}
                  </div>

                  {(activeJob.status === 'processing' || activeJob.status === 'interrupted') && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-4 text-xs">
                        <span
                          className={`font-medium ${
                            activeJob.status === 'interrupted'
                              ? 'text-amber-800 dark:text-amber-300'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {activeJob.statusText}
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-blue-700 shrink-0 dark:text-blue-400">
                          {activeJob.progress}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full transition-transform duration-150 ${
                            activeJob.status === 'interrupted' ? 'bg-amber-500' : 'bg-blue-600'
                          }`}
                          style={{
                            width: '100%',
                            transform: `translateX(-${100 - activeJob.progress}%)`,
                          }}
                        />
                      </div>
                      {activeJob.status === 'interrupted' && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          临时音频缓存仅保存在本机浏览器用于断点续传，任务完成后会自动清理释放磁盘空间。
                        </p>
                      )}
                    </div>
                  )}

                  {activeJob.status === 'error' && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800 space-y-2.5 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div className="space-y-1">
                          <p className="font-semibold">转换未能完成：{activeJob.statusText}</p>
                          <p className="leading-relaxed opacity-90">
                            {activeJob.errorDetail || '请尝试切换国内镜像或使用 WASM CPU 后端重试。'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onRetryWithMirror(activeJob.id)}
                          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-100/50 dark:bg-slate-900 dark:text-red-300 dark:border-red-800"
                        >
                          改用国内镜像 (hf-mirror.com) 重试
                        </button>
                        <button
                          type="button"
                          onClick={() => onRetryWithWasm(activeJob.id)}
                          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                        >
                          改用 CPU (WASM) 重试
                        </button>
                        <button
                          type="button"
                          onClick={() => relinkInputRef.current?.click()}
                          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                        >
                          重新选择文件
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Transcript Text Output Panel */}
            <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    识别文本结果
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    <span>{charCount.toLocaleString()} 字</span>
                    {activeJob.elapsedMs && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>耗时 {(activeJob.elapsedMs / 1000).toFixed(1)} 秒</span>
                      </>
                    )}
                    {activeJob.detectedLanguage && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>语种 {activeJob.detectedLanguage}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={includeTimestamps}
                      onChange={(e) => setIncludeTimestamps(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>显示分段时间戳</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => onConvertSimplified(activeJob.id)}
                    disabled={!displayedText || activeJob.status === 'processing'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>转为简体</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!displayedText}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>复制全文</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onExportTxt(activeJob, includeTimestamps)}
                    disabled={!displayedText}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>导出 TXT</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 p-5">
                <textarea
                  value={displayedText}
                  onChange={(e) => {
                    if (!includeTimestamps && activeJob.status !== 'processing') {
                      onUpdateText(activeJob.id, e.target.value);
                    }
                  }}
                  readOnly={includeTimestamps || activeJob.status === 'processing'}
                  placeholder={
                    activeJob.status === 'processing'
                      ? '正在本地识别音频，文字将实时显示在这里...'
                      : '点击上方「开始语音转文字」，识别结果将显示在此处，可直接编辑或导出 TXT。'
                  }
                  className="min-h-[300px] w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:bg-slate-950"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
