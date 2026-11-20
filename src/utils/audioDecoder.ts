const TARGET_SAMPLE_RATE = 16000;

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

function linearResample(
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

/**
 * Decodes any browser-supported audio or video file locally in memory
 * and resamples its audio track to 16kHz mono Float32Array for Whisper inference.
 */
export async function decodeMediaTo16kMono(file: File): Promise<DecodedAudioResult> {
  let arrayBuffer: ArrayBuffer;
  try {
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

  const audioCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      '浏览器无法直接解码该文件的音轨。请确认文件未损坏且包含音频轨道（建议 MP3、WAV、M4A、OGG、WebM 或标准 H.264+AAC MP4）。'
    );
  } finally {
    await audioCtx.close().catch(() => {});
  }

  const duration = decodedBuffer.duration;
  const monoSource = downmixToMono(decodedBuffer);

  if (decodedBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return {
      audioData: monoSource,
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }

  // Use OfflineAudioContext for high-quality anti-aliased resampling, with linear fallback on memory limits
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
      audioData: linearResample(monoSource, decodedBuffer.sampleRate, TARGET_SAMPLE_RATE),
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }
}
