import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Code2, Copy, FileVideo2, Film, Folder, FolderOpen, HardDrive, Image, LoaderCircle, Maximize2, Minimize2, Minus, MonitorPlay, Pause, Play, Plus, RotateCcw, Scissors, Settings2, ShieldCheck, Sparkles, Upload, Volume2, VolumeX, X, Zap } from 'lucide-react';
import type { EngineStatus, ExportOptions, JobProgress, MediaInfo, Settings, Tool } from '../shared/types';

const tools = [
  { id: 'convert' as const, title: '格式转换', icon: ArrowLeftRight, heading: '换个格式，继续精彩。', description: 'MP4 与 GIF 轻松互转，让画面去到你想去的地方。' },
  { id: 'trim' as const, title: '片段截取', icon: Scissors, heading: '留下刚刚好的片段。', description: '选择开始与结束时间，把值得保留的瞬间单独收藏。' },
  { id: 'compress' as const, title: '压缩与缩放', icon: Minimize2, heading: '轻一点，也精彩。', description: '调整尺寸与画质，为分享找到合适的大小。' },
];
const initialSettings: Settings = { ffmpegPath: '', ffprobePath: '', outputDir: '' };
function rememberedOptions(): { quality: ExportOptions['quality']; mute: boolean; loop: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem('frameforge-options') || '{}');
    return { quality: ['high', 'balanced', 'small'].includes(saved.quality) ? saved.quality : 'balanced', mute: saved.mute === true, loop: saved.loop !== false };
  } catch { return { quality: 'balanced', mute: false, loop: true }; }
}
const sizeLabel = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const timeLabel = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '00:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${s >= 3600 ? `${Math.floor(s / 3600).toString().padStart(2, '0')}:` : ''}${Math.floor(s % 3600 / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};
const directoryOf = (input: string) => input.slice(0, Math.max(input.lastIndexOf('\\'), input.lastIndexOf('/')));
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
function IconButton({ children, label, onClick, disabled = false }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return <button className="icon-button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="field"><div className="field-heading"><span>{label}</span>{hint && <small>{hint}</small>}</div>{children}</div>;
}

export default function App() {
  const remembered = useRef(rememberedOptions()).current;
  const [tool, setTool] = useState<Tool>('convert');
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [format, setFormat] = useState<'mp4' | 'gif'>('gif');
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(15);
  const [quality, setQuality] = useState<ExportOptions['quality']>(remembered.quality);
  const [mute, setMute] = useState(remembered.mute);
  const [loop, setLoop] = useState(remembered.loop);
  const [fastTrim, setFastTrim] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [outputDir, setOutputDir] = useState('');
  const [job, setJob] = useState<JobProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [command, setCommand] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [previewProxy, setPreviewProxy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const dragDepth = useRef(0);
  const importing = useRef(false);
  const busy = starting || job?.state === 'running';
  const activeTool = tools.find(item => item.id === tool)!;

  useEffect(() => {
    try { localStorage.setItem('frameforge-options', JSON.stringify({ quality, mute, loop })); } catch { /* Preferences are optional if storage is unavailable. */ }
  }, [quality, mute, loop]);
  useEffect(() => {
    if (job) document.querySelector('.job-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [job?.id, job?.state]);

  useEffect(() => {
    void window.desktop.getSettings().then(value => { setSettings(value); setOutputDir(value.outputDir); }).catch(error => setError(errorMessage(error)));
    void window.desktop.engineStatus().then(setEngine).catch(error => setError(errorMessage(error)));
    return window.desktop.onProgress(progress => { setJob(progress); setStarting(false); if (progress.state !== 'running') setCancelling(false); });
  }, []);

  const importFile = useCallback(async (input?: string | null) => {
    if (busy || importing.current || generatingPreview) return;
    importing.current = true;
    setError(''); setLoading(true);
    try {
      const selected = input ?? await window.desktop.selectFile();
      if (!selected) return;
      const info = await window.desktop.inspect(selected);
      setMedia(info); setStart(0); setEnd(info.duration); setJob(null); setCommand('');
      const nextFormat = tool === 'convert' ? (info.format === 'mp4' ? 'gif' : 'mp4') : info.format;
      setFormat(nextFormat); setWidth(nextFormat === 'gif' ? Math.min(640, info.width) : 0); setFps(nextFormat === 'gif' ? 15 : 0);
      setFastTrim(false); setCurrentTime(0); setPlaying(false); setPreviewError(false); setPreviewProxy(false); setPreviewUrl(info.url);
      setOutputDir(settings.outputDir || directoryOf(info.path));
    } catch (error) { setError(errorMessage(error)); }
    finally { importing.current = false; setLoading(false); }
  }, [busy, generatingPreview, settings.outputDir, tool]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void importFile(); }
      if (event.key === 'Escape') { setSettingsOpen(false); setHelpOpen(false); setCommand(''); }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [importFile]);

  function selectTool(next: Tool) {
    if (busy || loading || generatingPreview) return;
    setTool(next); setCommand(''); setFastTrim(false); setJob(null);
    const nextFormat = next === 'convert' ? (media?.format === 'gif' ? 'mp4' : 'gif') : media?.format ?? 'mp4';
    setFormat(nextFormat);
    setWidth(nextFormat === 'gif' ? Math.min(640, media?.width ?? 640) : 0);
    setFps(nextFormat === 'gif' ? 15 : 0);
  }
  function changeFormat(next: 'mp4' | 'gif') {
    setFormat(next); setFastTrim(false); setCommand('');
    setWidth(next === 'gif' ? Math.min(640, media?.width ?? 640) : 0); setFps(next === 'gif' ? 15 : 0);
  }
  const options = (): ExportOptions => ({ input: media!.path, tool, format, width, fps, start, end, quality, mute, loop, fastTrim: fastTrim && tool === 'trim', outputDir });
  async function exportFile() {
    if (!media || busy) return;
    setError(''); setStarting(true); setCommand('');
    try { const progress = await window.desktop.start(options()); setJob(previous => previous?.id === progress.id && previous.state !== 'running' ? previous : progress); }
    catch (error) { setError(errorMessage(error)); }
    finally { setStarting(false); }
  }
  async function cancel() {
    setCancelling(true);
    try { await window.desktop.cancel(); } catch (error) { setError(errorMessage(error)); setCancelling(false); }
  }
  async function showCommand() {
    if (!media) return;
    try { setCommand(await window.desktop.command(options())); setCopied(false); } catch (error) { setError(errorMessage(error)); }
  }
  async function chooseOutput() {
    try { const selected = await window.desktop.selectDirectory(); if (selected) setOutputDir(selected); } catch (error) { setError(errorMessage(error)); }
  }
  async function proxyPreview() {
    if (!media) return;
    setGeneratingPreview(true); setError('');
    try { setPreviewUrl(await window.desktop.preview(media.path)); setPreviewError(false); setPreviewProxy(true); }
    catch (error) { setError(errorMessage(error)); }
    finally { setGeneratingPreview(false); }
  }
  function seek(time: number) { setCurrentTime(time); if (video.current) video.current.currentTime = Math.min(time, video.current.duration || time); }
  function togglePlayback() { if (video.current) { if (video.current.paused) void video.current.play().catch(() => setPreviewError(true)); else video.current.pause(); } }
  async function safeFileAction(action: 'open' | 'reveal', input: string) {
    try { await window.desktop[action](input); } catch (error) { setError(errorMessage(error)); }
  }
  function dropFile(event: DragEvent) {
    event.preventDefault(); setDragging(false); dragDepth.current = 0;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1) { setError('一次请选择一个 MP4 或 GIF 文件。'); return; }
    if (files[0]) { const input = window.desktop.droppedPath(files[0]); if (input) void importFile(input); }
  }
  const selectionError = media && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > media.duration + 0.01 || end - start < 0.04);
  const selectedDuration = Math.max(0, end - start);
  const effectiveWidth = format === 'mp4' ? Math.ceil((width || media?.width || 0) / 2) * 2 : width || media?.width || 0;
  const outputHeight = media ? Math.round(media.height * effectiveWidth / media.width / (format === 'mp4' ? 2 : 1)) * (format === 'mp4' ? 2 : 1) : 0;

  return <div className="application" onDragOver={event => event.preventDefault()} onDrop={dropFile} onDragEnter={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) { dragDepth.current++; setDragging(true); } }} onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}>
    <header className="titlebar">
      <div className="traffic-lights"><button className="close" onClick={() => window.desktop.window('close')} aria-label="关闭"><X size={8}/></button><button className="minimize" onClick={() => window.desktop.window('minimize')} aria-label="最小化"><Minus size={8}/></button><button className="maximize" onClick={() => window.desktop.window('maximize')} aria-label="最大化"><Plus size={8}/></button></div>
      <span className="window-title">FrameForge <span>—</span> 媒体工作台</span>
      <button className="titlebar-expand" aria-label="切换最大化" onClick={() => window.desktop.window('maximize')}><Maximize2 size={13}/></button>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon"><Clapperboard size={23} strokeWidth={1.8}/></div><div><strong>FrameForge<span className="brand-dot">.</span></strong><small>让处理，更轻松</small></div></div>
        <div className="nav-section-label">工作空间</div>
        <nav aria-label="媒体工具">{tools.map(item => <button key={item.id} disabled={busy} className={`nav-item ${tool === item.id ? 'active' : ''}`} onClick={() => selectTool(item.id)}><item.icon size={18}/><span>{item.title}</span>{tool === item.id && <span className="nav-active-dot"/>}</button>)}</nav>
        <div className="sidebar-note"><div className="note-symbol"><Sparkles size={17}/></div><strong>小工具，大有可为。</strong><p>把繁琐交给工具，<br/>把时间留给创作。</p><div className="note-formats"><span>MP4</span><ArrowLeftRight size={12}/><span>GIF</span></div></div>
        <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)} disabled={busy}><Settings2 size={18}/><span>偏好设置</span></button><button className="nav-item" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/><span>使用指南</span></button><div className="sidebar-version"><span className={`status-dot ${engine?.ready ? 'ready' : ''}`}/><span>FrameForge</span><small>v0.1.0</small></div></div>
      </aside>
      <main className="workspace">
        <div className="breadcrumb-row"><div className="breadcrumb">工作空间<ChevronRight size={13}/><span>{activeTool.title}</span></div><span className="local-badge"><ShieldCheck size={13}/>本地处理 · 无需上传</span></div>
        <section className="page-heading"><div><div className="eyebrow">A LITTLE TOOL. A LOT OF POSSIBILITIES.</div><h1>{activeTool.heading}</h1><p>{activeTool.description}</p></div><span className="heading-symbol"><activeTool.icon size={26} strokeWidth={1.4}/></span></section>
        {error && <div className="error-banner" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError('')}><X size={15}/></IconButton></div>}
        {engine && !engine.ready && <div className="engine-warning"><Zap size={15}/><span>{engine.error}</span><button onClick={() => setSettingsOpen(true)}>前往设置<ArrowRight size={13}/></button></div>}
        <div className="work-grid">
          <section className="editor-card">
            <div className="card-heading"><div><MonitorPlay size={16}/><strong>素材预览</strong>{media && <span className="tiny-badge">{media.format.toUpperCase()}</span>}</div><button className="text-button" onClick={() => void importFile()} disabled={busy || loading || generatingPreview}>{media ? '更换文件' : '导入素材'}<Plus size={14}/></button></div>
            {!media ? <div className="empty-preview">
              <div className="empty-grid"/>
              <div className="file-illustration" aria-hidden="true"><div className="file-card file-card-back"><Image size={25} strokeWidth={1.3}/><span>GIF</span><i/><i/></div><div className="file-card file-card-front"><Film size={29} strokeWidth={1.35}/><span>MP4</span><i/><i/></div><span className="file-orbit"><ArrowLeftRight size={18}/></span></div>
              <h2>把灵感，拖进来。</h2><p>拖放一个 MP4 或 GIF 文件到这里<br/>剩下的，交给 FrameForge。</p>
              <button className="primary-button import-button" disabled={loading || busy} onClick={() => void importFile()}>{loading ? <LoaderCircle className="spin" size={16}/> : <FolderOpen size={16}/>}<span>{loading ? '正在读取素材…' : '选择文件'}</span><kbd>Ctrl O</kbd></button>
              <div className="supported-formats"><span>MP4</span><span>GIF</span><i/>所有处理均在你的电脑上完成</div>
            </div> : <>
              <div className={`media-preview ${previewError ? 'failed-preview' : ''}`}>
                {previewError ? <div className="preview-fallback"><MonitorPlay size={34}/><strong>这个编码暂时无法直接预览</strong><p>仍可正常导出，或生成前 30 秒的静音兼容预览。</p><button className="secondary-button" disabled={generatingPreview || busy} onClick={() => void proxyPreview()}>{generatingPreview ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>} {generatingPreview ? '正在生成预览…' : '生成兼容预览'}</button></div> : media.format === 'gif' && !previewProxy ? <img src={previewUrl} alt={media.name} onError={() => setPreviewError(true)}/> : <video key={previewUrl} ref={video} src={previewUrl} playsInline preload="metadata" onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setPreviewError(true)} onClick={togglePlayback}/>}
                <span className="preview-label">{previewProxy ? '兼容预览 · 前 30 秒 · 静音' : media.format === 'gif' ? 'GIF 动画预览' : '原始素材'}</span>
              </div>
              <div className="player-controls"><IconButton label={playing ? '暂停' : '播放'} disabled={media.format === 'gif' && !previewProxy || previewError} onClick={togglePlayback}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</IconButton><span className="player-time">{timeLabel(currentTime)}</span><input aria-label="预览播放位置" className="seek-range" type="range" min={0} max={previewProxy ? Math.min(30, media.duration) : media.duration} step={0.01} value={Math.min(currentTime, media.duration)} disabled={media.format === 'gif' && !previewProxy || previewError} onChange={event => seek(Number(event.target.value))}/><span className="player-time muted">{timeLabel(previewProxy ? Math.min(30, media.duration) : media.duration)}</span><IconButton label="重播" onClick={() => seek(0)} disabled={media.format === 'gif' && !previewProxy}><RotateCcw size={14}/></IconButton></div>
              <div className="media-file-row"><div className="media-file-icon"><FileVideo2 size={19}/></div><div><strong title={media.path}>{media.name}</strong><span>{sizeLabel(media.size)}<i/> {media.width} × {media.height}<i/>{media.fps.toFixed(2).replace(/\.00$/, '')} fps</span></div><span className="duration-badge">{timeLabel(media.duration)}</span></div>
            </>}
            <div className="selection-panel"><div className="selection-heading"><span><Scissors size={14}/>处理范围</span><small>{media ? `已选 ${selectedDuration.toFixed(2)} 秒` : '导入后可设置开始与结束时间'}</small></div>
              <div className="selection-track"><div className="selection-fill" style={{ left: `${media ? start / media.duration * 100 : 0}%`, right: `${media ? (1 - end / media.duration) * 100 : 0}%` }}/><input aria-label="范围开始滑块" type="range" min={0} max={media?.duration || 1} step={0.01} value={start} disabled={!media || busy} onChange={event => { const next = Number(event.target.value); setStart(Math.max(0, Math.min(next, end - 0.04))); }}/><input aria-label="范围结束滑块" type="range" min={0} max={media?.duration || 1} step={0.01} value={end || 1} disabled={!media || busy} onChange={event => setEnd(Math.min(media?.duration ?? 1, Math.max(Number(event.target.value), start + 0.04)))}/></div>
              <div className="time-fields"><label><span>开始</span><input aria-label="开始时间（秒）" type="number" min={0} max={end} step={0.01} value={Number(start.toFixed(3))} disabled={!media || busy} onChange={event => setStart(Number(event.target.value))}/><small>秒</small></label><ArrowRight size={14}/><label><span>结束</span><input aria-label="结束时间（秒）" type="number" min={start} max={media?.duration || 0} step={0.01} value={Number(end.toFixed(3))} disabled={!media || busy} onChange={event => setEnd(Number(event.target.value))}/><small>秒</small></label><IconButton label="重置为完整时长" disabled={!media || busy} onClick={() => { setStart(0); setEnd(media?.duration || 0); }}><RotateCcw size={14}/></IconButton></div>
              {media && media.format === 'mp4' && <div className="set-time-row"><button disabled={busy || previewError} onClick={() => setStart(Math.min(currentTime, end - 0.04))}>当前位置设为开始</button><button disabled={busy || currentTime <= start} onClick={() => setEnd(Math.min(media.duration, Math.max(currentTime, start + 0.04)))}>当前位置设为结束</button></div>}
              {selectionError && <small className="inline-error">请选择有效范围，结束时间须大于开始时间。</small>}
            </div>
          </section>
          <aside className="options-card"><div className="card-heading"><div><Settings2 size={16}/><strong>导出设置</strong></div><span className="small-label">{tool === 'trim' ? 'TRIM' : tool === 'compress' ? 'OPTIMIZE' : 'CONVERT'}</span></div>
            <fieldset disabled={busy} className="options-fields">
              <Field label="输出格式"><div className="format-toggle"><button className={format === 'mp4' ? 'selected' : ''} disabled={tool !== 'convert' && media?.format === 'gif'} onClick={() => changeFormat('mp4')}><Film size={16}/><span>MP4</span>{format === 'mp4' && <Check size={13}/>}</button><button className={format === 'gif' ? 'selected' : ''} disabled={tool !== 'convert' && media?.format === 'mp4'} onClick={() => changeFormat('gif')}><Image size={16}/><span>GIF</span>{format === 'gif' && <Check size={13}/>}</button></div><p className="field-hint">{format === 'gif' ? '轻巧的动态画面，适合分享与展示' : 'H.264 视频，兼顾画质与播放兼容性'}</p></Field>
              {tool === 'trim' && media?.format === 'mp4' && <div className="fast-trim-option"><label className="switch-row"><span><Zap size={14}/>快速截取</span><input type="checkbox" checked={fastTrim} onChange={event => setFastTrim(event.target.checked)}/><i className="switch"/></label><p className="field-hint">{fastTrim ? '直接复制视频流，起止位置可能偏移；忽略尺寸、帧率与画质设置。' : '默认精确截取，重新编码所选片段。'}</p></div>}
              <div className={fastTrim ? 'disabled-fields' : ''}>
                <Field label="输出尺寸" hint="保持宽高比"><div className="select-wrap"><select aria-label="输出尺寸" value={width} disabled={busy || fastTrim} onChange={event => setWidth(Number(event.target.value))}><option value={0}>原始尺寸{media ? ` · ${media.width} px` : ''}</option>{[320,480,640,960,1280,1920, ...(width && ![320,480,640,960,1280,1920].includes(width) ? [width] : [])].sort((a,b) => a-b).map(value => <option key={value} value={value}>{value} px 宽{value === 640 ? ' · 推荐 GIF' : ''}</option>)}</select><ChevronDown size={14}/></div></Field>
                <Field label="帧率" hint={format === 'gif' ? '影响流畅度与体积' : '每秒画面数'}><div className="select-wrap"><select aria-label="输出帧率" value={fps} disabled={busy || fastTrim} onChange={event => setFps(Number(event.target.value))}><option value={0}>跟随原始素材</option>{[10,12,15,20,24,25,30,60].map(value => <option key={value} value={value}>{value} fps{value === 15 && format === 'gif' ? ' · 推荐' : ''}</option>)}</select><ChevronDown size={14}/></div></Field>
                {format === 'mp4' && <Field label="画质预设"><div className="quality-options">{([{id:'high',label:'高清'}, {id:'balanced',label:'均衡'}, {id:'small',label:'更小'}] as const).map(item => <button key={item.id} disabled={busy || fastTrim} className={quality === item.id ? 'selected' : ''} onClick={() => setQuality(item.id)}>{item.label}</button>)}</div><p className="field-hint">{quality === 'high' ? '保留更多细节，文件相对较大' : quality === 'small' ? '优先减小体积，画面细节有所减少' : '画面细节与文件体积之间的平衡'}</p></Field>}
              </div>
              <div className="option-divider"/>
              {format === 'gif' ? <label className="switch-row"><span><RotateCcw size={15}/>循环播放</span><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)}/><i className="switch"/></label> : <label className="switch-row"><span>{mute ? <VolumeX size={15}/> : <Volume2 size={15}/>}移除音频</span><input type="checkbox" checked={mute} onChange={event => setMute(event.target.checked)}/><i className="switch"/></label>}
              <div className="output-summary"><div className="summary-icon">{format === 'gif' ? <Image size={18}/> : <Film size={18}/>}</div><div><strong>{format === 'gif' ? 'GIF 动画' : 'MP4 视频'}</strong><span>{media ? `${fastTrim ? media.width : effectiveWidth} × ${fastTrim ? media.height : outputHeight} · ${selectedDuration.toFixed(1)} 秒` : '导入素材后显示输出信息'}</span></div></div>
              <div className="tips-box"><Sparkles size={14}/><p>{format === 'gif' ? 'GIF 越长、尺寸越大，文件也会越大。短片段搭配 15 fps 通常更合适。' : tool === 'compress' ? '压缩后的大小取决于素材。选择较小尺寸或“更小”画质，通常更省空间。' : '导出自动适配偶数尺寸，方便在常见播放器和平台中使用。'}</p></div>
            </fieldset>
          </aside>
        </div>
        <section className="export-bar"><div className="output-location"><div className="folder-symbol"><Folder size={21}/></div><div><span>保存到</span><button disabled={busy} onClick={() => void chooseOutput()} title={outputDir || '选择输出文件夹'}>{outputDir || '导入后默认保存到原文件夹'}<ChevronDown size={12}/></button></div></div><div className="export-actions"><IconButton label="查看 PowerShell 命令" disabled={!media || busy} onClick={() => void showCommand()}><Code2 size={18}/></IconButton><span className="vertical-divider"/>{busy ? <button className="secondary-button cancel-button" disabled={cancelling || starting} onClick={() => void cancel()}>{cancelling ? <LoaderCircle className="spin" size={15}/> : <X size={15}/>} {cancelling ? '正在取消…' : '取消处理'}</button> : <button className="primary-button export-button" disabled={!media || loading || generatingPreview || !engine?.ready || Boolean(selectionError)} onClick={() => void exportFile()}><ArrowDownToLine size={17}/>开始处理<ArrowRight size={16}/></button>}</div></section>
        {job && <section className={`job-panel ${job.state}`} aria-live="polite"><div className="job-header"><span>{job.state === 'running' ? <LoaderCircle className="spin" size={17}/> : job.state === 'completed' ? <CheckCircle2 size={17}/> : <CircleHelp size={17}/>}<strong>{job.state === 'running' ? '正在雕琢每一帧…' : job.state === 'completed' ? '处理完成，可以出发了。' : job.state === 'cancelled' ? '任务已取消' : '处理未完成'}</strong></span><small>{job.state === 'running' ? `${Math.floor(job.percent)}% · 已用 ${timeLabel(job.elapsed)}${job.speed && job.speed !== 'N/A' ? ` · ${job.speed}` : ''}` : `用时 ${timeLabel(job.elapsed)}${job.size ? ` · ${sizeLabel(job.size)}` : ''}`}</small></div>{job.state === 'running' && <div className="job-track"><div style={{ width: `${job.percent}%` }}/></div>}{job.state === 'completed' && <div className="completed-details"><span title={job.output}>{job.output}</span><button onClick={() => void safeFileAction('open', job.output)}>打开文件<ArrowRight size={13}/></button><button onClick={() => void safeFileAction('reveal', job.output)}><FolderOpen size={14}/>所在文件夹</button></div>}{job.error && <pre className="job-error">{job.error}</pre>}</section>}
        <footer className="workspace-footer"><span><HardDrive size={12}/>文件留在本地，创作自在发生。</span><span><span className={`status-dot ${engine?.ready ? 'ready' : ''}`}/>{engine?.ready ? 'FFmpeg 已就绪' : engine ? 'FFmpeg 需要配置' : '正在检查 FFmpeg…'}</span></footer>
      </main>
    </div>
    {dragging && <div className="drop-overlay"><div><Upload size={38}/><h2>松开，开始你的下一帧。</h2><p>支持一个 MP4 或 GIF 文件</p></div></div>}
    {settingsOpen && <SettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={async next => { const saved = await window.desktop.saveSettings(next); setSettings(saved); setOutputDir(saved.outputDir || (media ? directoryOf(media.path) : '')); setEngine(await window.desktop.engineStatus()); setSettingsOpen(false); }}/>}
    {command && <Modal title="PowerShell 命令" icon={<Code2 size={19}/>} onClose={() => setCommand('')}><p className="modal-description">可复制到 PowerShell 执行。应用实际导出时使用临时文件，并自动避开同名文件。</p><pre className="command-code">{command}</pre><div className="modal-actions"><button className="primary-button" onClick={() => { void navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(error => setError(errorMessage(error))); }}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? '已复制' : '复制命令'}</button></div></Modal>}
    {helpOpen && <Modal title="几步，完成处理。" icon={<CircleHelp size={19}/>} onClose={() => setHelpOpen(false)}><div className="help-steps">{[['01','导入素材','拖入一个 MP4 或 GIF，或者按 Ctrl + O 选择文件。'],['02','选择工具与参数','转换格式、截取片段或压缩尺寸；右侧设置会随工具变化。'],['03','开始处理','选好保存位置，等待导出完成，即可打开结果。']].map(([number,title,description]) => <div key={number}><span>{number}</span><section><strong>{title}</strong><p>{description}</p></section></div>)}</div><div className="help-note"><ShieldCheck size={18}/><p>默认保留原文件，重名结果自动编号。快速截取受关键帧影响，精确截取会重新编码。GIF 不含音频。兼容预览仅包含前 30 秒静音画面，导出仍使用原素材。</p></div><p className="modal-description">第一版专注单文件处理。批量、画面裁剪和 GPU 加速留待后续。</p></Modal>}
  </div>;
}

function Modal({ title, icon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{icon}{title}</h2><IconButton label="关闭对话框" onClick={onClose}><X size={18}/></IconButton></div>{children}</section></div>;
}
function SettingsModal({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (settings: Settings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function choose(key: keyof Settings) {
    try { const selected = key === 'outputDir' ? await window.desktop.selectDirectory() : await window.desktop.selectExecutable(); if (selected) setDraft(value => ({ ...value, [key]: selected })); }
    catch (error) { setError(errorMessage(error)); }
  }
  return <Modal title="偏好设置" icon={<Settings2 size={19}/>} onClose={onClose}><p className="modal-description">工具路径留空时，优先使用应用附带的版本，再从系统 PATH 查找。指定 FFmpeg 后会优先查找同文件夹的 FFprobe。</p><fieldset disabled={saving} className="settings-fields">{([{ key: 'ffmpegPath', label: 'FFmpeg', placeholder: '自动检测 ffmpeg.exe' },{ key: 'ffprobePath', label: 'FFprobe', placeholder: '自动检测 ffprobe.exe' },{ key: 'outputDir', label: '默认输出文件夹', placeholder: '默认与原文件保存在一起' }] as const).map(item => <Field key={item.key} label={item.label}><div className="path-input"><input aria-label={item.label} placeholder={item.placeholder} value={draft[item.key]} onChange={event => setDraft(value => ({ ...value, [item.key]: event.target.value }))}/><IconButton label={`选择 ${item.label}`} onClick={() => void choose(item.key)}><FolderOpen size={16}/></IconButton></div></Field>)}</fieldset>{error && <p className="inline-error">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={() => setDraft(initialSettings)}>恢复自动检测</button><button className="primary-button" disabled={saving} onClick={() => { setSaving(true); setError(''); void onSave(draft).catch(error => setError(errorMessage(error))).finally(() => setSaving(false)); }}>{saving ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}保存设置</button></div></Modal>;
}
