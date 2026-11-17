import React from 'react';
import { Cpu, HardDrive, Lock, ShieldCheck } from 'lucide-react';

export const PrivacyGuideView: React.FC = () => {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          本地离线架构与隐私安全说明
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          声迹工坊采用浏览器端侧推理架构，确保敏感会议录音、私人影像与内部素材绝不离开您的设备。
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Lock className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <h2>零媒体上传与沙盒隔离</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            您拖入的所有视频和音频文件均通过浏览器原生 Web Audio API 直接在内存中解码重采样为 16kHz 单声道波形，全程不产生任何媒体文件网络上传请求。
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <h2>WebGPU 与 WASM 双引擎加速</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            语音模型通过 ONNX Runtime Web 在独立的 Web Worker 后台线程运行，支持调用本地显卡 WebGPU 并行加速，并在无独立显卡时无缝回退至多线程 WebAssembly CPU 计算。
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <HardDrive className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <h2>永久离线缓存与本地目录挂载</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            首次下载的 Whisper 模型权重与 WASM 运行时文件会自动持久化于浏览器 Cache Storage；同时支持在物理断网电脑上直接导入本地模型文件夹运行。
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <h2>本地 IndexedDB 转录存档</h2>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            已完成转录的字幕时间轴与文稿修改内容实时保存至本地浏览器 IndexedDB 数据库，关闭或刷新页面后仍可继续校对与导出。
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          高效批量处理操作建议
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          <li>
            点击「离线模型库」预先缓存 <span className="font-medium text-slate-800 dark:text-slate-200">Whisper Base</span> 或 <span className="font-medium text-slate-800 dark:text-slate-200">Whisper Small</span> 模型，随后即可勾选「严格离线模式」在无网环境长期使用。
          </li>
          <li>
            处理数十个视频时，直接点击「导入文件夹」将整批文件加入队列，点击「开始批量转录」后系统会自动逐个解码识别，互不阻塞界面操作。
          </li>
          <li>
            转录完成后点击队列任意文件名即可联动本地播放器校对时间轴，最后使用「批量导出 ZIP」一次性打包所有文件的 SRT 与 TXT 文稿。
          </li>
        </ol>
      </div>
    </div>
  );
};
