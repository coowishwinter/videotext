import React from 'react';
import { ExportSettings, SubtitleChunk } from '../types/transcribe';
import { generateSrt, generateTxt } from '../utils/subtitleFormatter';

interface FormatGuideViewProps {
  settings: ExportSettings;
  onChangeSettings: (patch: Partial<ExportSettings>) => void;
}

const SAMPLE_CHUNKS: SubtitleChunk[] = [
  {
    id: 'sample-1',
    start: 1.2,
    end: 5.65,
    text: '欢迎使用声迹工坊，所有音视频解码与语音识别均在本地浏览器完成。',
  },
  {
    id: 'sample-2',
    start: 6.1,
    end: 10.42,
    text: '支持直接导出标准 SRT 字幕文件，可无缝导入剪映、Premiere 与达芬奇。',
  },
];

export const FormatGuideView: React.FC<FormatGuideViewProps> = ({
  settings,
  onChangeSettings,
}) => {
  const sampleSrt = generateSrt(SAMPLE_CHUNKS, { maxLineChars: settings.srtMaxLineChars });
  const sampleTxt = generateTxt(SAMPLE_CHUNKS, '', {
    mode: settings.txtMode,
    title: settings.txtIncludeTitle ? '示例会议录音.mp4' : undefined,
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          SRT 与 TXT 导出格式规范
        </h1>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          自定义批量导出的字符编码、字幕自动换行宽度与纯文本排版方式，修改后实时应用于单文件及 ZIP 批量导出。
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* SRT Settings */}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            SRT 字幕文件配置 (.srt)
          </h2>

          <label className="flex cursor-pointer items-start justify-between gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-800 dark:text-slate-200">
                写入 UTF-8 BOM 文件头
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                推荐开启，可防止 Windows 记事本或部分旧版剪辑软件打开中文 SRT 时出现乱码
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.srtIncludeBom}
              onChange={(e) => onChangeSettings({ srtIncludeBom: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
          </label>

          <div className="space-y-1.5">
            <label
              htmlFor="srt-max-chars"
              className="block text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              单行最大字符数（自动断行）
            </label>
            <select
              id="srt-max-chars"
              value={settings.srtMaxLineChars}
              onChange={(e) =>
                onChangeSettings({ srtMaxLineChars: Number(e.target.value) })
              }
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value={0}>不自动断行（保留原始长句）</option>
              <option value={18}>18 字（适合竖屏短视频字幕）</option>
              <option value={24}>24 字（适合横屏 16:9 标准双行）</option>
              <option value={32}>32 字（适合宽屏长句展示）</option>
            </select>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              SRT 导出实时样例
            </p>
            <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed tabular-nums text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {sampleSrt}
            </pre>
          </div>
        </div>

        {/* TXT Settings */}
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            TXT 纯文本文稿配置 (.txt)
          </h2>

          <div className="space-y-1.5">
            <label
              htmlFor="txt-mode"
              className="block text-xs font-medium text-slate-800 dark:text-slate-200"
            >
              文本段落组织方式
            </label>
            <select
              id="txt-mode"
              value={settings.txtMode}
              onChange={(e) =>
                onChangeSettings({
                  txtMode: e.target.value as ExportSettings['txtMode'],
                })
              }
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="lines">按字幕断句逐行输出</option>
              <option value="continuous">拼接为连续自然段落</option>
              <option value="timestamped">每行前缀保留时间戳 [MM:SS]</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-3">
            <div>
              <span className="block text-xs font-medium text-slate-800 dark:text-slate-200">
                在文稿顶部写入原文件名标题
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                便于多份采访录音或网课资料归档检索
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.txtIncludeTitle}
              onChange={(e) => onChangeSettings({ txtIncludeTitle: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
          </label>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              TXT 导出实时样例
            </p>
            <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {sampleTxt}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
