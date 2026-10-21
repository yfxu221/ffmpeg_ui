import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildArguments, capture, inspectMedia, validateOptions, type Binaries } from './engine';
import { exportDuration } from '../shared/geometry';
import { frameTimeAt } from '../shared/timeline';
import type { ExportOptions, PreviewAsset } from '../shared/types';

type Kind = 'source' | 'frame' | 'result';
type Pending = { key: string; abort: AbortController; promise: Promise<PreviewAsset> };
function sourceArguments(input: string, output: string, gif: boolean, duration: number) {
  return ['-v','error','-nostdin', ...(gif ? ['-ignore_loop','1'] : []), '-i',input,
    '-map','0:v:0','-map','0:a?','-t',String(duration),'-vf',`scale='min(960,iw)':-2,pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1${gif ? `,tpad=stop_mode=clone:stop_duration=${duration}` : ''}`,
    '-fps_mode','vfr','-enc_time_base:v','1:1000','-video_track_timescale','1000',
    '-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output];
}
export class PreviewManager {
  private pending = new Map<Kind, Pending>();
  private cache = new Map<string, PreviewAsset>();
  private directory?: Promise<string>;
  private disposed = false;
  private sequence = { source: 0, frame: 0, result: 0 };
  constructor(private root: string) {}

  async source(input: string, binaries: Binaries) {
    const sequence = ++this.sequence.source;
    const media = await inspectMedia(input, binaries);
    return this.generate('source', input, binaries, '', 'mp4', media.duration, async (output, signal) => {
      await capture(binaries.ffmpeg, sourceArguments(input, output, media.format === 'gif', media.duration), 600000, signal);
    }, undefined, sequence);
  }
  async frame(input: string, time: number, binaries: Binaries) {
    const sequence = ++this.sequence.frame;
    const media = await inspectMedia(input, binaries);
    if (!Number.isFinite(time) || time < 0 || time >= media.duration) throw new Error('取帧时间须位于素材时长内。');
    const actual = frameTimeAt(media, time);
    return this.generate('frame', input, binaries, String(actual), 'png', 0, async (output, signal) => {
      await capture(binaries.ffmpeg, ['-v','error','-nostdin','-ss',String(actual), ...(media.format === 'gif' ? ['-ignore_loop','1'] : []), '-i',input,
        '-map','0:v:0','-frames:v','1','-an','-vf',"scale='min(1280,iw)':-1",'-update','1',output], 120000, signal);
    }, actual, sequence);
  }
  async result(options: ExportOptions, binaries: Binaries) {
    const sequence = ++this.sequence.result;
    const media = await inspectMedia(options.input, binaries);
    const normalized = validateOptions(options, media);
    return this.generate('result', options.input, binaries, JSON.stringify({ ...normalized, outputDir: '' }), options.format, exportDuration(normalized), async (output, signal) => {
      await capture(binaries.ffmpeg, buildArguments(normalized, output), 600000, signal);
      if (options.format === 'gif') {
        const exported = await inspectMedia(output, binaries);
        await capture(binaries.ffmpeg, sourceArguments(output, `${output}.mp4`, true, exported.duration), 600000, signal);
        return `${output}.mp4`;
      }
    }, options.format === 'png' ? normalized.frameTime : undefined, sequence);
  }
  private async generate(kind: Kind, input: string, binaries: Binaries, extra: string, format: PreviewAsset['format'], duration: number,
    render: (output: string, signal: AbortSignal) => Promise<string | void>, time: number | undefined, sequence: number): Promise<PreviewAsset> {
    if (this.disposed || sequence !== this.sequence[kind]) throw new Error('预览已取消');
    const stat = await fs.stat(input);
    if (this.disposed || sequence !== this.sequence[kind]) throw new Error('预览已取消');
    const key = createHash('sha256').update(JSON.stringify([kind,input,stat.size,stat.mtimeMs,binaries.ffmpeg,extra])).digest('hex');
    const cached = this.cache.get(key);
    const existing = this.pending.get(kind);
    if (existing?.key === key) return existing.promise;
    existing?.abort.abort();
    if (cached) return cached;
    const abort = new AbortController();
    if (!this.directory) this.directory = fs.mkdtemp(path.join(this.root, 'frameforge-preview-'));
    const promise = (async () => {
      const directory = await this.directory!;
      if (abort.signal.aborted || this.disposed) throw new Error('预览已取消');
      const output = path.join(directory, `${randomUUID()}.${format}`);
      try {
        const playbackPath = await render(output, abort.signal) || undefined;
        if (abort.signal.aborted || this.disposed) throw new Error('预览已取消');
        const info = await fs.stat(output);
        if (!info.size) throw new Error('未生成可用的预览，请调整时间范围。');
        let actualDuration = duration;
        if (format !== 'png') {
          const raw = JSON.parse(await capture(binaries.ffprobe, ['-v','error','-show_entries','format=duration','-of','json',output], 30000, abort.signal));
          const probed = Number(raw.format?.duration);
          if (Number.isFinite(probed) && probed > 0) actualDuration = probed;
        }
        const asset = { path: output, url: '', format, duration: actualDuration, time, playbackPath };
        if (this.cache.size >= 32) {
          const oldest = this.cache.keys().next().value!;
          const expired = this.cache.get(oldest)!;
          this.cache.delete(oldest);
          if (expired.format === 'png') void fs.rm(expired.path, { force: true }).catch(() => {});
        }
        this.cache.set(key, asset);
        return asset;
      } catch (error) { await Promise.allSettled([fs.rm(output, { force: true }), fs.rm(`${output}.mp4`, { force: true })]); throw error; }
    })();
    const pending = { key, abort, promise };
    this.pending.set(kind, pending);
    try { return await promise; }
    finally { if (this.pending.get(kind) === pending) this.pending.delete(kind); }
  }
  async cancelResult() {
    this.sequence.result++;
    const current = this.pending.get('result');
    current?.abort.abort();
    await current?.promise.catch(() => {});
  }
  async dispose() {
    this.disposed = true;
    const pending = [...this.pending.values()];
    pending.forEach(job => job.abort.abort());
    await Promise.allSettled(pending.map(job => job.promise));
    if (this.directory) await fs.rm(await this.directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
