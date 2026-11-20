import { MPEGDecoder } from 'mpg123-decoder';

const TARGET_SAMPLE_RATE = 16000;
const MP3_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB per streaming slice

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'flv',
  'wmv',
  'ts',
  'mpeg',
  'mpg',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'flac',
  'ogg',
  'opus',
  'aac',
  'wma',
  'aiff',
  'amr',
  'weba',
]);

export function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isSupportedMediaFile(file: File): boolean {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
    return true;
  }
  const ext = getFileExtension(file.name);
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
}

export function detectMediaKind(file: File): 'audio' | 'video' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = getFileExtension(file.name);
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'audio';
}

export function probeMediaDurationFromUrl(
  objectUrl: string,
  kind: 'audio' | 'video'
): Promise<number> {
  return new Promise((resolve) => {
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      element.removeAttribute('src');
      element.load();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(0);
    }, 4000);

    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = Number.isFinite(element.duration) ? element.duration : 0;
      cleanup();
      resolve(dur);
    };
    element.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(0);
    };
    element.src = objectUrl;
  });
}

function downmixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }
  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i];
    }
  }
  const inv = 1 / numberOfChannels;
  for (let i = 0; i < length; i++) {
    mono[i] *= inv;
  }
  return mono;
}

/**
 * Downmixes multi-channel Float32 arrays and resamples to 16kHz Int16 PCM
 * using anti-aliased box-averaging (for downsampling) or linear interpolation.
 */
function downmixAndResampleTo16kInt16(
  channels: Float32Array[],
  samplesCount: number,
  fromSampleRate: number
): Int16Array {
  const chCount = channels.length;
  if (samplesCount <= 0 || chCount === 0 || fromSampleRate <= 0) {
    return new Int16Array(0);
  }

  const ratio = fromSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(samplesCount / ratio));
  const out = new Int16Array(outputLength);

  const left = channels[0];
  const right = chCount > 1 ? channels[1] : null;

  if (ratio >= 1.5) {
    // Anti-aliased bin averaging for downsampling (e.g. 44.1kHz/48kHz -> 16kHz)
    for (let i = 0; i < outputLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samplesCount, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      if (right && chCount === 2) {
        for (let j = start; j < end; j++) {
          sum += (left[j] + right[j]) * 0.5;
        }
      } else if (chCount > 2) {
        for (let j = start; j < end; j++) {
          let chSum = 0;
          for (let c = 0; c < chCount; c++) chSum += channels[c][j];
          sum += chSum / chCount;
        }
      } else {
        for (let j = start; j < end; j++) {
          sum += left[j];
        }
      }
      const val = sum / (end - start);
      const clamped = val < -1 ? -1 : val > 1 ? 1 : val;
      out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
  } else {
    // Linear interpolation when sampleRate <= 24kHz
    for (let i = 0; i < outputLength; i++) {
      const srcPos = i * ratio;
      const idx0 = Math.floor(srcPos);
      const idx1 = Math.min(samplesCount - 1, idx0 + 1);
      const frac = srcPos - idx0;
      let v0 = left[idx0];
      let v1 = left[idx1];
      if (right && chCount === 2) {
        v0 = (v0 + right[idx0]) * 0.5;
        v1 = (v1 + right[idx1]) * 0.5;
      }
      const val = v0 * (1 - frac) + v1 * frac;
      const clamped = val < -1 ? -1 : val > 1 ? 1 : val;
      out[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
  }

  return out;
}

function linearResampleFloat32(
  input: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
): Float32Array {
  if (fromSampleRate === toSampleRate) return input;
  const ratio = fromSampleRate / toSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

export interface DecodedAudioResult {
  audioData: Float32Array;
  duration: number;
  sampleRate: number;
}

export type DecodeProgressCallback = (progressPct: number, detail: string) => void;

/**
 * Streaming MP3 decoder using libmpg123 WASM in 2 MB file slices.
 * Keeps peak RAM tiny even for 150MB-500MB+ MP3 files instead of triggering
 * Chromium's 2GB AudioContext.decodeAudioData allocation ceiling.
 */
async function decodeMp3Streaming(
  file: File,
  onProgress?: DecodeProgressCallback
): Promise<DecodedAudioResult> {
  const decoder = new MPEGDecoder();
  await decoder.ready;

  const pcm16Chunks: Array<Int16Array | null> = [];
  let totalSamples16k = 0;
  let offset = 0;
  const totalBytes = file.size;

  try {
    while (offset < totalBytes) {
      const end = Math.min(totalBytes, offset + MP3_CHUNK_BYTES);
      let sliceBuf: ArrayBuffer;
      try {
        sliceBuf = await file.slice(offset, end).arrayBuffer();
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const msg = err instanceof Error ? err.message : String(err);
        if (
          name === 'NotReadableError' ||
          msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('could not be read')
        ) {
          throw new Error(
            '无法读取本地文件（文件句柄权限已过期或被占用）。请点击「重新选择文件」再次导入该媒体文件。'
          );
        }
        throw new Error(`文件读取失败：${msg}`);
      }

      const decoded = decoder.decode(new Uint8Array(sliceBuf));
      if (decoded.samplesDecoded > 0 && decoded.sampleRate > 0) {
        const chunk16k = downmixAndResampleTo16kInt16(
          decoded.channelData,
          decoded.samplesDecoded,
          decoded.sampleRate
        );
        if (chunk16k.length > 0) {
          pcm16Chunks.push(chunk16k);
          totalSamples16k += chunk16k.length;
        }
      }

      offset = end;
      if (onProgress) {
        const pct = Math.min(99, Math.round((offset / totalBytes) * 100));
        onProgress(pct, `正在流式解码 MP3 音轨 (${pct}%)`);
      }

      // Yield briefly to keep UI responsive during large MP3 decoding
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    try {
      decoder.free();
    } catch {
      // ignore cleanup error
    }
  }

  if (totalSamples16k === 0) {
    throw new Error('MP3_NO_SAMPLES');
  }

  const audioData = new Float32Array(totalSamples16k);
  let writeOffset = 0;
  for (let i = 0; i < pcm16Chunks.length; i++) {
    const chunk = pcm16Chunks[i];
    if (!chunk) continue;
    for (let j = 0; j < chunk.length; j++) {
      audioData[writeOffset + j] = chunk[j] / 32768;
    }
    writeOffset += chunk.length;
    pcm16Chunks[i] = null; // allow GC immediately
  }

  return {
    audioData,
    duration: totalSamples16k / TARGET_SAMPLE_RATE,
    sampleRate: TARGET_SAMPLE_RATE,
  };
}

/**
 * Decodes any browser-supported audio or video file locally in memory
 * and resamples its audio track to 16kHz mono Float32Array for Whisper inference.
 */
export async function decodeMediaTo16kMono(
  file: File,
  onProgress?: DecodeProgressCallback
): Promise<DecodedAudioResult> {
  const ext = getFileExtension(file.name);
  const isMp3 =
    ext === 'mp3' ||
    file.type === 'audio/mpeg' ||
    file.type === 'audio/mp3' ||
    file.type === 'audio/x-mpeg';

  if (isMp3) {
    try {
      return await decodeMp3Streaming(file, onProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'MP3_NO_SAMPLES') {
        throw err;
      }
      // Fall through to AudioContext in case a non-MP3 file was misnamed .mp3
    }
  }

  let arrayBuffer: ArrayBuffer;
  try {
    onProgress?.(20, '正在读取媒体文件...');
    arrayBuffer = await file.arrayBuffer();
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (
      name === 'NotReadableError' ||
      msg.toLowerCase().includes('permission') ||
      msg.toLowerCase().includes('could not be read')
    ) {
      throw new Error(
        '无法读取本地文件（文件句柄权限已过期或被占用）。请点击「重新选择文件」再次导入该媒体文件。'
      );
    }
    throw new Error(`文件读取失败：${msg}`);
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error('当前浏览器不支持 Web Audio API，无法在本地提取音轨。');
  }

  onProgress?.(55, '正在解码音频轨道...');
  const audioCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    const sizeMb = Math.round(file.size / (1024 * 1024));
    if (['mkv', 'avi', 'flv', 'wmv'].includes(ext)) {
      throw new Error(
        `该 ${sizeMb}MB 的 .${ext} 文件可能使用了浏览器内核不支持的音轨编码（如 AC3/DTS）。建议转为 MP3 后再导入。`
      );
    }
    throw new Error(
      `浏览器原生解码器无法一次解开该 ${sizeMb}MB 文件（可能超出浏览器单次解码内存上限或音轨编码不受支持）。建议先用音频工具转为标准 MP3 格式后再导入，即可支持流式分片解码。`
    );
  } finally {
    await audioCtx.close().catch(() => {});
  }

  onProgress?.(85, '正在重采样为 16kHz 单声道...');
  const duration = decodedBuffer.duration;
  const monoSource = downmixToMono(decodedBuffer);

  if (decodedBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return {
      audioData: monoSource,
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }

  try {
    const targetLength = Math.max(1, Math.ceil(duration * TARGET_SAMPLE_RATE));
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const monoBuffer = offlineCtx.createBuffer(1, monoSource.length, decodedBuffer.sampleRate);
    monoBuffer.getChannelData(0).set(monoSource);
    const source = offlineCtx.createBufferSource();
    source.buffer = monoBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    return {
      audioData: new Float32Array(rendered.getChannelData(0)),
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  } catch {
    return {
      audioData: linearResampleFloat32(monoSource, decodedBuffer.sampleRate, TARGET_SAMPLE_RATE),
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }
}
