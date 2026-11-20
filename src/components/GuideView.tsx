import React from 'react';
import { Cpu, Lock, ShieldCheck, WifiOff } from 'lucide-react';

export const GuideView: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          使用说明与本地隐私架构
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          声迹工坊当前专注于稳定可靠的纯本地语音转文字能力。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>音视频零上传</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            音视频文件通过浏览器原生 Web Audio API 在内存中提取音轨并重采样为 16kHz 单声道波形，随后由 Web Worker 中的 ONNX Runtime 本地执行 Whisper 模型推理，全程不经过任何外部服务器。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <WifiOff className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>首次缓存后支持完全断网</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            模型文件首次下载后会自动持久保存在浏览器的 Cache Storage 中；勾选「严格离线模式」后，即使拔掉网线也能直接转换音频与视频。也可选择本地硬盘上的模型目录离线载入。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Cpu className="h-4 w-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
            <span>格式兼容与大文件建议</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            支持 MP3、WAV、M4A、AAC、FLAC、OGG、WebM 以及标准编码的 MP4/MOV 视频。如果遇到个别冷门封装视频无法解码，可先用 FFmpeg 等工具转出 MP3/WAV 音频再拖入，速度更快且内存占用更低。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Lock className="h-4 w-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
            <span>下载源与计算后端排查</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            若模型加载失败，可在左侧设置将下载源切换为「国内镜像加速 (hf-mirror.com)」。若特定显卡驱动导致 WebGPU 报错或卡顿，可将计算后端固定为「CPU 多线程 (WASM)」。
          </p>
        </div>
      </div>
    </div>
  );
};
