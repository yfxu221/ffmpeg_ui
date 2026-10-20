import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EngineStatus, ExportOptions, JobProgress, MediaInfo, Settings } from '../shared/types';

export interface Binaries { ffmpeg: string; ffprobe: string; }
const captureChildren = new Set<ReturnType<typeof spawn>>();
export function stopCaptures() { for (const child of captureChildren) child.kill(); }
export function capture(executable: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    captureChildren.add(child);
    child.once('close', () => captureChildren.delete(child));
    let stdout = '', stderr = '', settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(stdout); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('读取媒体信息超时，请确认文件和 FFmpeg 路径。')); }, timeout);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 8_000_000) { child.kill(); finish(new Error('媒体信息过大。')); } });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
    child.on('error', error => finish(new Error(`无法运行 ${path.basename(executable)}：${error.message}`)));
    child.on('close', code => finish(code === 0 ? undefined : new Error(stderr || `进程退出，代码 ${code}`)));
  });
}

async function findExecutable(name: string, explicit: string, bundledDir?: string): Promise<string> {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = explicit ? [explicit] : [
    ...(bundledDir ? [path.join(bundledDir, file)] : []),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir.replace(/^"|"$/g, ''), file)),
  ];
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) return path.resolve(candidate); } catch { /* Try the next location. */ }
  }
  throw new Error(`找不到 ${name}，请在设置中选择 ${file}。`);
}

export async function resolveBinaries(settings: Settings, bundledDir?: string): Promise<Binaries> {
  const ffmpeg = await findExecutable('ffmpeg', settings.ffmpegPath, bundledDir);
  let ffprobe = settings.ffprobePath;
  if (!ffprobe && settings.ffmpegPath) {
    const sibling = path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    try { await fs.access(sibling); ffprobe = sibling; } catch { /* Fall back to bundled / PATH. */ }
  }
  return { ffmpeg, ffprobe: await findExecutable('ffprobe', ffprobe, bundledDir) };
}

export async function checkEngine(settings: Settings, bundledDir?: string): Promise<EngineStatus> {
  try {
    const binaries = await resolveBinaries(settings, bundledDir);
    const [version] = await Promise.all([
      capture(binaries.ffmpeg, ['-version'], 10000), capture(binaries.ffprobe, ['-version'], 10000),
    ]);
    return { ready: true, ...binaries, version: version.split(/\r?\n/)[0] };
  } catch (error) {
    return { ready: false, ffmpeg: '', ffprobe: '', version: '', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function inspectMedia(input: string, binaries: Binaries): Promise<MediaInfo> {
  if (typeof input !== 'string' || !path.isAbsolute(input) || !/\.(mp4|gif)$/i.test(input)) throw new Error('请选择 MP4 或 GIF 文件。');
  const stat = await fs.stat(input);
  if (!stat.isFile()) throw new Error('输入路径不是文件。');
  const raw = JSON.parse(await capture(binaries.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input]));
  const video = raw.streams?.find((stream: { codec_type: string; disposition?: { attached_pic?: number } }) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw new Error('这个文件没有可处理的视频或动画画面。');
  const duration = Number(raw.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取有效时长，文件可能损坏。');
  const [num, den] = String(video.avg_frame_rate || video.r_frame_rate || '0/1').split('/').map(Number);
  const rotation = Number(video.side_data_list?.find((item: { rotation?: number }) => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    path: path.resolve(input), name: path.basename(input), size: stat.size, duration,
    width: Number(rotated ? video.height : video.width), height: Number(rotated ? video.width : video.height),
    fps: den ? num / den : 0, codec: video.codec_name ?? 'unknown',
    hasAudio: Boolean(raw.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'audio')),
    format: path.extname(input).toLowerCase() === '.gif' ? 'gif' : 'mp4', url: '',
  };
}

export function validateOptions(options: ExportOptions, media: MediaInfo): ExportOptions {
  if (!options || !['convert', 'trim', 'compress'].includes(options.tool) || !['mp4', 'gif'].includes(options.format)) throw new Error('无效的处理类型。');
  if (!['high', 'balanced', 'small'].includes(options.quality)) throw new Error('无效的质量预设。');
  for (const key of ['start', 'end', 'width', 'fps'] as const) if (typeof options[key] !== 'number' || !Number.isFinite(options[key])) throw new Error('参数必须为有效数字。');
  if (options.start < 0 || options.end > media.duration + 0.05 || options.end - options.start < 0.04) throw new Error('结束时间必须大于开始时间，且位于媒体时长以内。');
  if (options.width !== 0 && (!Number.isInteger(options.width) || options.width < 16 || options.width > 7680)) throw new Error('输出宽度应为 16–7680 的整数，或选择原始尺寸。');
  if (options.fps !== 0 && (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 120)) throw new Error('帧率应为 1–120 的整数。');
  if (typeof options.outputDir !== 'string' || !path.isAbsolute(options.outputDir)) throw new Error('请选择有效的输出文件夹。');
  for (const key of ['mute', 'loop', 'fastTrim'] as const) if (typeof options[key] !== 'boolean') throw new Error('无效的导出选项。');
  if (options.fastTrim && (options.tool !== 'trim' || options.format !== 'mp4' || media.format !== 'mp4')) throw new Error('快速截取仅支持 MP4 → MP4。');
  return { ...options, end: Math.min(options.end, media.duration) };
}

export function buildArguments(options: ExportOptions, output: string): string[] {
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n', '-progress', 'pipe:1', '-stats_period', '0.3'];
  // Input seeking is frame accurate while transcoding; stream copy is explicitly approximate.
  args.push('-ss', String(options.start));
  if (path.extname(options.input).toLowerCase() === '.gif') args.push('-ignore_loop', '1');
  args.push('-i', options.input, '-t', String(options.end - options.start), '-map', '0:v:0');
  if (options.fastTrim) {
    if (!options.mute) args.push('-map', '0:a?');
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', output);
    return args;
  }
  const filters: string[] = [];
  if (options.fps) filters.push(`fps=${options.fps}`);
  if (options.format === 'gif') {
    if (options.width) filters.push(`scale=${options.width}:-1:flags=lanczos`);
    // Per-frame palettes avoid buffering the entire selected clip in memory.
    filters.push('split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1:dither=sierra2_4a');
    args.push('-vf', filters.join(','), '-an', '-loop', options.loop ? '0' : '-1', output);
  } else {
    if (!options.mute) args.push('-map', '0:a?');
    if (options.width) filters.push(`scale=${options.width}:-2:flags=lanczos`);
    filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    filters.push('setsar=1');
    args.push('-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', String({ high: 18, balanced: 23, small: 28 }[options.quality]), '-pix_fmt', 'yuv420p');
    if (options.mute) args.push('-an'); else args.push('-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart', output);
  }
  return args;
}

export function displayCommand(executable: string, args: string[]): string {
  // PowerShell single quotes preserve spaces, $, backticks, and Unicode literally.
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `& ${[executable, ...args].map(quote).join(' ')}`;
}

function outputName(media: MediaInfo, options: ExportOptions): string {
  const suffix = { convert: 'converted', trim: 'trimmed', compress: 'compressed' }[options.tool];
  return `${path.parse(media.name).name}_${suffix}.${options.format}`;
}

async function publishFile(temporary: string, directory: string, name: string): Promise<string> {
  const parsed = path.parse(name);
  for (let index = 0; index < 10000; index++) {
    const destination = path.join(directory, `${parsed.name}${index ? ` (${index})` : ''}${parsed.ext}`);
    try {
      try { await fs.link(temporary, destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
        await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
      }
      return destination;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  throw new Error('输出文件重名过多，请更换文件夹。');
}

export class MediaEngine extends EventEmitter {
  private current?: { progress: JobProgress; child?: ChildProcessWithoutNullStreams; cancelled: boolean; done: Promise<void>; stopTimer?: NodeJS.Timeout };
  private preparing = false;
  get busy() { return this.preparing || Boolean(this.current); }

  async start(options: ExportOptions, binaries: Binaries): Promise<JobProgress> {
    if (this.busy) throw new Error('已有任务在处理中，请等待完成或取消。');
    this.preparing = true;
    try {
      const media = await inspectMedia(options.input, binaries);
      options = validateOptions(options, media);
      const directory = await fs.stat(options.outputDir);
      if (!directory.isDirectory()) throw new Error('输出路径不是文件夹。');
      await fs.access(options.outputDir, constants.W_OK);
      const output = path.join(options.outputDir, outputName(media, options));
      const progress: JobProgress = { id: randomUUID(), state: 'running', percent: 0, elapsed: 0, speed: '', output, command: displayCommand(binaries.ffmpeg, buildArguments(options, output)) };
      let resolveDone!: () => void;
      const done = new Promise<void>(resolve => { resolveDone = resolve; });
      const current = this.current = { progress, cancelled: false, done };
      setImmediate(() => { void this.run(options, binaries, media, current).finally(resolveDone); });
      return { ...progress };
    } finally { this.preparing = false; }
  }

  private async run(options: ExportOptions, binaries: Binaries, media: MediaInfo, current: NonNullable<MediaEngine['current']>) {
    const began = Date.now();
    let workDir = '', errorLog = '';
    const emit = () => { current.progress.elapsed = (Date.now() - began) / 1000; this.emit('progress', { ...current.progress }); };
    const pulse = setInterval(emit, 500);
    try {
      workDir = await fs.mkdtemp(path.join(options.outputDir, '.frameforge-'));
      const temporary = path.join(workDir, `output.${options.format}`);
      if (current.cancelled) return;
      await new Promise<void>((resolve, reject) => {
        const child = current.child = spawn(binaries.ffmpeg, buildArguments(options, temporary), { windowsHide: true, shell: false });
        let buffer = '';
        child.stdout.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
          for (const line of lines) {
            const [key, value] = line.split('=');
            if (key === 'out_time_us' && Number.isFinite(Number(value))) current.progress.percent = Math.min(99, Math.max(0, Number(value) / 1e6 / (options.end - options.start) * 100));
            if (key === 'speed') current.progress.speed = value?.trim() ?? '';
          }
        });
        child.stderr.on('data', chunk => { errorLog = (errorLog + chunk.toString()).slice(-16000); });
        child.once('error', reject);
        child.once('close', code => code === 0 || current.cancelled ? resolve() : reject(new Error(errorLog || `FFmpeg 退出代码：${code}`)));
      });
      current.child = undefined;
      if (!current.cancelled) {
        const output = await publishFile(temporary, options.outputDir, outputName(media, options));
        current.progress = { ...current.progress, state: 'completed', percent: 100, output, size: (await fs.stat(output)).size };
      }
    } catch (error) {
      if (!current.cancelled) current.progress = { ...current.progress, state: 'failed', error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearInterval(pulse); clearTimeout(current.stopTimer);
      if (current.cancelled && current.progress.state !== 'completed') current.progress.state = 'cancelled';
      if (workDir) {
        try { await fs.rm(workDir, { recursive: true, force: true }); }
        catch { current.progress.error = `临时文件未能清理，可手动删除：${workDir}`; }
      }
      this.current = undefined;
      emit();
    }
  }

  async cancel(): Promise<void> {
    const current = this.current;
    if (!current || current.progress.state === 'completed') return;
    current.cancelled = true;
    // Force stop is safe: FFmpeg only writes into our private temporary directory.
    current.child?.kill();
    await current.done;
  }
}
