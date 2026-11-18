import JSZip from 'jszip';
import { ExportSettings, MediaQueueItem, SubtitleChunk } from '../types/transcribe';

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

export function formatSrtTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatCompactTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSec = Math.floor(safe);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function parseSrtTimestamp(value: string): number | null {
  const trimmed = value.trim().replace('.', ',');
  const match = /^(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})$/.exec(trimmed);
  if (!match) return null;
  const hrs = Number(match[1]);
  const mins = Number(match[2]);
  const secs = Number(match[3]);
  const ms = Number(match[4].padEnd(3, '0'));
  if (mins >= 60 || secs >= 60) return null;
  return hrs * 3600 + mins * 60 + secs + ms / 1000;
}

/**
 * Removes stray spaces between CJK characters & before Chinese punctuation
 * while keeping normal spaces between Latin words intact.
 */
export function cleanTranscriptSpacing(text: string): string {
  return text
    .trim()
    .replace(/([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])\s+([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])/g, '$1$2')
    .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Splits overly long multi-sentence subtitle cues along natural punctuation boundaries
 * and distributes timestamps proportionally to text length.
 */
function splitCueBySentence(
  start: number,
  end: number,
  text: string,
  baseIdx: number
): SubtitleChunk[] {
  const clean = cleanTranscriptSpacing(text);
  if (clean.length < 28 || end - start < 3.5) {
    return [
      {
        id: `${baseIdx}-${Math.round(start * 100)}-${Math.random().toString(36).slice(2, 6)}`,
        start,
        end,
        text: clean,
      },
    ];
  }

  const parts = clean
    .split(/(?<=[。！？；?!;])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [
      {
        id: `${baseIdx}-${Math.round(start * 100)}-${Math.random().toString(36).slice(2, 6)}`,
        start,
        end,
        text: clean,
      },
    ];
  }

  const totalChars = parts.reduce((sum, p) => sum + p.length, 0) || 1;
  const duration = Math.max(0.5, end - start);
  const result: SubtitleChunk[] = [];
  let cursor = start;

  for (let j = 0; j < parts.length; j++) {
    const part = parts[j];
    const ratio = part.length / totalChars;
    const segEnd =
      j === parts.length - 1 ? end : Math.min(end, cursor + duration * ratio);
    result.push({
      id: `${baseIdx}-${j}-${Math.round(cursor * 100)}-${Math.random().toString(36).slice(2, 5)}`,
      start: cursor,
      end: Math.max(cursor + 0.3, segEnd),
      text: part,
    });
    cursor = segEnd;
  }

  return result;
}

export interface RawWhisperChunk {
  timestamp: [number | null, number | null];
  text: string;
}

export function normalizeWhisperChunks(
  rawChunks: RawWhisperChunk[] | undefined,
  fallbackText: string,
  totalDuration: number
): SubtitleChunk[] {
  if (!rawChunks || rawChunks.length === 0) {
    const clean = cleanTranscriptSpacing(fallbackText);
    if (!clean) return [];
    return splitCueBySentence(0, Math.max(1, totalDuration || 3), clean, 0);
  }

  const normalized: SubtitleChunk[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const raw = rawChunks[i];
    const text = cleanTranscriptSpacing(raw.text || '');
    if (!text) continue;

    let start =
      raw.timestamp?.[0] ?? (normalized.length > 0 ? normalized[normalized.length - 1].end : 0);
    let end = raw.timestamp?.[1];

    if (start === null || !Number.isFinite(start) || start < 0) {
      start = normalized.length > 0 ? normalized[normalized.length - 1].end : 0;
    }

    if (end === null || end === undefined || !Number.isFinite(end) || end <= start) {
      const nextStart = rawChunks[i + 1]?.timestamp?.[0];
      if (typeof nextStart === 'number' && nextStart > start) {
        end = nextStart;
      } else {
        end = totalDuration > start ? Math.min(totalDuration, start + 4) : start + 3;
      }
    }

    if (normalized.length > 0) {
      const prev = normalized[normalized.length - 1];
      if (start < prev.start) {
        start = prev.end;
      }
      if (end <= start) {
        end = start + 0.5;
      }
    }

    const splitCues = splitCueBySentence(start, end, text, i);
    normalized.push(...splitCues);
  }

  return normalized;
}

export function wrapSubtitleText(text: string, maxChars: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!maxChars || maxChars <= 0 || clean.length <= maxChars) return clean;

  const lines: string[] = [];
  let remaining = clean;

  while (remaining.length > maxChars) {
    let breakIdx = -1;
    const searchStart = Math.floor(maxChars * 0.55);
    for (let i = maxChars; i >= searchStart; i--) {
      const ch = remaining[i];
      if ('，。！？；：、,.!?; '.includes(ch)) {
        breakIdx = ch === ' ' ? i : i + 1;
        break;
      }
    }
    if (breakIdx <= 0) {
      breakIdx = maxChars;
    }
    lines.push(remaining.slice(0, breakIdx).trim());
    remaining = remaining.slice(breakIdx).trim();
  }
  if (remaining) lines.push(remaining);
  return lines.join('\n');
}

export function generateSrt(
  chunks: SubtitleChunk[],
  options?: { maxLineChars?: number }
): string {
  const maxChars = options?.maxLineChars ?? 0;
  return chunks
    .map((chunk, idx) => {
      const startStr = formatSrtTimestamp(chunk.start);
      const endStr = formatSrtTimestamp(Math.max(chunk.end, chunk.start + 0.2));
      const body = maxChars > 0 ? wrapSubtitleText(chunk.text, maxChars) : chunk.text.trim();
      return `${idx + 1}\n${startStr} --> ${endStr}\n${body}`;
    })
    .join('\n\n')
    .concat(chunks.length > 0 ? '\n' : '');
}

export function generateTxt(
  chunks: SubtitleChunk[],
  fullText: string,
  options: { mode: 'continuous' | 'lines' | 'timestamped'; title?: string }
): string {
  let body = '';
  if (chunks.length === 0) {
    body = cleanTranscriptSpacing(fullText);
  } else if (options.mode === 'continuous') {
    body = cleanTranscriptSpacing(chunks.map((c) => c.text.trim()).join(' '));
  } else if (options.mode === 'lines') {
    body = chunks.map((c) => c.text.trim()).join('\n');
  } else {
    body = chunks
      .map(
        (c) =>
          `[${formatCompactTimestamp(c.start)} -> ${formatCompactTimestamp(c.end)}] ${c.text.trim()}`
      )
      .join('\n');
  }

  if (options.title) {
    return `${options.title}\n${'='.repeat(Math.min(48, options.title.length + 4))}\n\n${body}\n`;
  }
  return body ? `${body}\n` : '';
}

export function getBaseFileName(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function downloadTextFile(content: string, filename: string, includeBom = false): void {
  const parts: BlobPart[] = includeBom ? ['\uFEFF', content] : [content];
  const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportBatchAsZip(
  items: MediaQueueItem[],
  format: 'srt' | 'txt' | 'both',
  settings: ExportSettings
): Promise<void> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const item of items) {
    if (item.status !== 'completed') continue;
    let base = getBaseFileName(item.fileName);
    if (usedNames.has(base)) {
      let counter = 2;
      while (usedNames.has(`${base}_${counter}`)) counter++;
      base = `${base}_${counter}`;
    }
    usedNames.add(base);

    if (format === 'srt' || format === 'both') {
      const srt = generateSrt(item.chunks, { maxLineChars: settings.srtMaxLineChars });
      const content = settings.srtIncludeBom ? '\uFEFF' + srt : srt;
      zip.file(`${base}.srt`, content);
    }
    if (format === 'txt' || format === 'both') {
      const txt = generateTxt(item.chunks, item.fullText, {
        mode: settings.txtMode,
        title: settings.txtIncludeTitle ? item.fileName : undefined,
      });
      zip.file(`${base}.txt`, txt);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `声迹工坊_批量导出_${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMergedTxt(items: MediaQueueItem[], settings: ExportSettings): void {
  const completed = items.filter((i) => i.status === 'completed');
  if (completed.length === 0) return;

  const sections = completed.map((item, idx) => {
    const header = `【${idx + 1}/${completed.length}】${item.fileName} (${formatDuration(item.duration)})`;
    const body = generateTxt(item.chunks, item.fullText, {
      mode: settings.txtMode,
      title: undefined,
    }).trim();
    return `${header}\n${'-'.repeat(40)}\n${body}`;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(sections.join('\n\n\n') + '\n', `合并转录文稿_${stamp}.txt`, settings.srtIncludeBom);
}
