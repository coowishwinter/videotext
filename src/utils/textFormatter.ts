import * as OpenCC from 'opencc-js/t2cn';
import * as OpenCCReverse from 'opencc-js/cn2t';
import { TranscriptSegment } from '../types/speech';

const t2sConverter = OpenCC.Converter({ from: 't', to: 'cn' });
const s2tConverter = OpenCCReverse.Converter({ from: 'cn', to: 't' });

export function convertToSimplifiedChinese(text: string): string {
  if (!text) return '';
  return t2sConverter(text);
}

export function convertToTraditionalChinese(text: string): string {
  if (!text) return '';
  return s2tConverter(text);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

/**
 * Removes stray whitespace between CJK characters and before CJK punctuation
 * while preserving normal spacing between Latin words.
 */
export function cleanTranscriptSpacing(text: string): string {
  return text
    .trim()
    .replace(
      /([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])\s+([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])/g,
      '$1$2'
    )
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ');
}

export function formatSegmentsText(
  segments: TranscriptSegment[],
  fallbackText: string,
  includeTimestamps: boolean
): string {
  if (!segments || segments.length === 0) {
    return cleanTranscriptSpacing(fallbackText);
  }
  if (!includeTimestamps) {
    return segments
      .map((seg) => cleanTranscriptSpacing(seg.text))
      .filter(Boolean)
      .join('\n');
  }
  return segments
    .map((seg) => {
      const clean = cleanTranscriptSpacing(seg.text);
      if (!clean) return '';
      return `[${formatDuration(seg.startSec)} - ${formatDuration(seg.endSec)}] ${clean}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function getBaseFileName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function downloadTxtFile(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
