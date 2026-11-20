import React from 'react';
import {
  CheckCircle2,
  Cpu,
  FileAudio,
  HelpCircle,
  Languages,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';

export const GuideView: React.FC = () => {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          使用说明与本地离线架构
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          声迹工坊是一款纯浏览器本地运行的语音转文字工具，所有解码与识别均在您的设备内部完成，无需上传任何音视频文件。
        </p>
      </div>

      {/* 1. 三步快速上手 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          一、三步快速开始
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              01. 配置模型与下载源
            </p>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              在左侧边栏选择模型（日常推荐 <strong>Whisper Base</strong>），语音语种默认已设为「<strong>简体中文（自动繁转简）</strong>」。国内网络建议将首次下载源切至 <strong>国内镜像加速 (hf-mirror.com)</strong>。
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              02. 导入音视频或现场录音
            </p>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              将音频或视频文件直接拖入工作区（或点击「导入音视频」），也可点击「麦克风录音测试」现场录制一段语音，立刻检验模型识别效果。
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              03. 开始转文字并导出
            </p>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              点击「开始语音转文字」，可实时看到提取音频、加载模型与逐段出字进度。完成后支持在线编辑、一键「转为简体」、复制全文或导出 UTF-8 格式的 <code>.txt</code> 文件。
            </p>
          </div>
        </div>
      </section>

      {/* 2. 模型选择建议 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            二、本地模型规格对比与选择建议
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">模型名称</th>
                <th className="py-2 pr-4 font-medium">缓存体积</th>
                <th className="py-2 pr-4 font-medium">速度 / 精度</th>
                <th className="py-2 font-medium">适用场景</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800/70 dark:text-slate-300">
              <tr>
                <td className="py-2.5 pr-4 font-medium whitespace-nowrap">Whisper Tiny</td>
                <td className="py-2.5 pr-4 font-mono tabular-nums whitespace-nowrap">~45 MB</td>
                <td className="py-2.5 pr-4 whitespace-nowrap">极速 / 基础</td>
                <td className="py-2.5">声音清晰的单人语音备忘、低内存电脑、快速试跑验证。</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium whitespace-nowrap">Whisper Base（推荐）</td>
                <td className="py-2.5 pr-4 font-mono tabular-nums whitespace-nowrap">~85 MB</td>
                <td className="py-2.5 pr-4 whitespace-nowrap">较快 / 均衡</td>
                <td className="py-2.5">日常会议录音、网课、播客、访谈的标准默认选择。</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium whitespace-nowrap">Whisper Small</td>
                <td className="py-2.5 pr-4 font-mono tabular-nums whitespace-nowrap">~255 MB</td>
                <td className="py-2.5 pr-4 whitespace-nowrap">适中 / 高精度</td>
                <td className="py-2.5">中英混杂、专业术语较多、带有轻度背景音的音频/视频。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. 核心特性卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Languages className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>三、简体中文自动转换</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            原生 Whisper 模型在识别中文时偶尔会输出繁体字。本工具内置纯本地 OpenCC 词库转换引擎：选择「<strong>简体中文</strong>」或「<strong>自动检测语言</strong>」时，流式输出和最终结果都会自动规范化为简体中文；结果框上方也提供「转为简体」快捷按钮。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <FileAudio className="h-4 w-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
            <span>四、大文件与格式兼容说明</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            支持 MP3、WAV、M4A、AAC、FLAC、OGG、WebM 以及标准 MP4/MOV 视频。针对 <strong>100MB~500MB+ 的大体积 MP3</strong>，工具采用 2MB 分片流式 WASM 解码，避免浏览器单次解码 2GB 内存上限报错；若遇到冷门格式超大视频无法解码，建议先转为 MP3 再导入。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <WifiOff className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>五、完全断网与内网离线使用</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            首次加载模型后，权重会自动保存在浏览器 Cache Storage 中；勾选「严格离线模式」即可断网运行。如需在完全隔离的内网电脑使用，可在「离线模型」页面直接选择本地硬盘上的 ONNX 模型文件夹挂载运行。
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>六、数据零上传与本地存储</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            音频波形提取、模型推理与识别结果全部保留在您的本地内存与浏览器 IndexedDB 中，不会向任何云端接口发送录音内容或转录文本，适合处理涉密会议、个人笔记与内部素材。
          </p>
        </div>
      </div>

      {/* 4. 常见问题排查 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-slate-700 dark:text-slate-300" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            七、常见问题排查
          </h2>
        </div>
        <ul className="space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>
              <strong>模型下载缓慢或一直失败：</strong>请在左侧「首次下载源」选择「国内镜像加速 (hf-mirror.com)」，网络通畅后再点「下载缓存」。
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>
              <strong>部分显卡 WebGPU 识别报错或无反应：</strong>请在左侧「本地计算后端」切换为「CPU 多线程 (WASM · 最稳定)」，兼容性最佳。
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>
              <strong>刷新页面后历史文件提示无法读取：</strong>浏览器重启或刷新后会回收本地文件句柄授权，点击「换个文件 / 重新选择文件」重新授权即可继续转写。
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
};
