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

export interface DecodedAudioResult {
  audioData: Float32Array;
  duration: number;
  sampleRate: number;
}

/**
 * Decodes any browser-supported audio or video file locally inside the browser
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
        '文件读取失败（权限失效或文件过大超出浏览器单次读取上限）。请确保文件位于本地硬盘且未被占用，大视频建议先提取 MP3/WAV 音轨或分段处理，然后点击「重新选择」。'
      );
    }
    throw new Error(`无法读取文件数据：${msg}`);
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error('当前浏览器不支持 Web Audio API，无法本地解码音视频。');
  }

  const audioCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;

  try {
    decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      '无法解码该文件的音轨。请确认文件未损坏且包含音轨，或使用标准编码（MP4/MOV/WebM/MP3/WAV/M4A/FLAC/OGG）。'
    );
  } finally {
    await audioCtx.close().catch(() => {});
  }

  const duration = decodedBuffer.duration;
  const targetLength = Math.max(1, Math.ceil(duration * TARGET_SAMPLE_RATE));

  // If already 16kHz mono, avoid an extra OfflineAudioContext pass
  if (decodedBuffer.sampleRate === TARGET_SAMPLE_RATE && decodedBuffer.numberOfChannels === 1) {
    const channelData = new Float32Array(decodedBuffer.getChannelData(0));
    return {
      audioData: channelData,
      duration,
      sampleRate: TARGET_SAMPLE_RATE,
    };
  }

  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const monoData = new Float32Array(renderedBuffer.getChannelData(0));

  return {
    audioData: monoData,
    duration,
    sampleRate: TARGET_SAMPLE_RATE,
  };
}
