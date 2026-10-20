export type Tool = 'convert' | 'trim' | 'compress';
export type OutputFormat = 'mp4' | 'gif';
export interface MediaInfo {
  path: string; name: string; size: number; duration: number;
  width: number; height: number; fps: number; codec: string;
  hasAudio: boolean; format: OutputFormat; url: string;
}
export interface Settings { ffmpegPath: string; ffprobePath: string; outputDir: string; }
export interface EngineStatus { ready: boolean; ffmpeg: string; ffprobe: string; version: string; error?: string; }
export interface ExportOptions {
  input: string; tool: Tool; format: OutputFormat; width: number; fps: number;
  start: number; end: number; quality: 'high' | 'balanced' | 'small';
  mute: boolean; loop: boolean; fastTrim: boolean; outputDir: string;
}
export interface JobProgress {
  id: string; state: 'running' | 'completed' | 'cancelled' | 'failed';
  percent: number; elapsed: number; speed: string; output: string;
  size?: number; error?: string; command: string;
}
export interface DesktopAPI {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  engineStatus(): Promise<EngineStatus>;
  selectFile(): Promise<string | null>;
  selectDirectory(): Promise<string | null>;
  selectExecutable(): Promise<string | null>;
  inspect(path: string): Promise<MediaInfo>;
  preview(path: string): Promise<string>;
  start(options: ExportOptions): Promise<JobProgress>;
  command(options: ExportOptions): Promise<string>;
  cancel(): Promise<void>;
  reveal(path: string): Promise<void>;
  open(path: string): Promise<void>;
  window(action: 'minimize' | 'maximize' | 'close'): void;
  droppedPath(file: File): string;
  onProgress(callback: (progress: JobProgress) => void): () => void;
}
