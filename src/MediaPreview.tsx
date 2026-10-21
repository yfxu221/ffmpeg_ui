import { useEffect, useRef, useState } from 'react';
import { Camera, Film, LoaderCircle, Music2, Pause, Play, RefreshCw, Repeat2, SkipBack, SkipForward, X } from 'lucide-react';
import type { ExportOptions, MediaInfo, PreviewAsset, VideoEffects } from '../shared/types';
import { frameIndex, frameTimeAt, stepFrame } from '../shared/timeline';
import { CropOverlay } from './Adjustments';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
export function preciseTime(time: number) {
  const ms = Math.round(Math.max(0, time) * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2,'0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2,'0')}.${(ms % 1000).toString().padStart(3,'0')}`;
}
interface Props {
  media: MediaInfo; options: ExportOptions; disabled: boolean; invalid: boolean; currentTime: number;
  onPosition: (time: number) => void; onFrameTime: (time: number) => void;
  onEffects: (effects: VideoEffects) => void; onBusyChange: (busy: boolean) => void;
}
export default function MediaPreview(p: Props) {
  const isStill = p.options.tool === 'extract' && p.options.format === 'png';
  const gif = p.media.format === 'gif';
  const [sourceUrl, setSourceUrl] = useState(gif ? '' : p.media.url);
  const [sourceLoading, setSourceLoading] = useState(gif);
  const [sourceError, setSourceError] = useState('');
  const [sourceRevision, setSourceRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rangePlaying, setRangePlaying] = useState(false);
  const [mode, setMode] = useState<'source' | 'result'>('source');
  const [frame, setFrame] = useState<PreviewAsset | null>(null);
  const [frameError, setFrameError] = useState('');
  const [result, setResult] = useState<{ key: string; asset: PreviewAsset } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [resultError, setResultError] = useState('');
  const [notice, setNotice] = useState('');
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const renderingRef = useRef(false);
  const rangeRef = useRef([p.options.start, p.options.end]);
  const positionRef = useRef(p.currentTime);
  positionRef.current = p.currentTime;
  const key = JSON.stringify({ ...p.options, outputDir: '' });
  const latestKey = useRef(key); latestKey.current = key;
  const resultFresh = result?.key === key;
  const wantsFrame = mode === 'source' && (isStill || gif && !playing);
  const target = frameTimeAt(p.media, isStill ? p.options.frameTime : p.currentTime);
  const frameFresh = frame && Math.abs((frame.time ?? -1) - target) < 0.000001;

  useEffect(() => {
    if (!gif && !sourceRevision) return;
    let stale = false;
    setSourceLoading(true); setSourceError('');
    void window.desktop.preview(p.media.path).then(url => {
      if (!stale) { setSourceUrl(url); setSourceLoading(false); }
    }).catch(error => { if (!stale) { setSourceError(message(error)); setSourceLoading(false); } });
    return () => { stale = true; };
  }, [p.media.path, gif, sourceRevision]);

  useEffect(() => {
    if (!wantsFrame || !Number.isFinite(target)) return;
    let stale = false;
    setFrameError('');
    const timer = setTimeout(() => {
      void window.desktop.framePreview(p.media.path, target).then(asset => { if (!stale) setFrame(asset); }).catch(error => {
        if (!stale && !message(error).includes('取消')) setFrameError(message(error));
      });
    }, 100);
    return () => { stale = true; clearTimeout(timer); };
  }, [wantsFrame, target, p.media.path]);

  useEffect(() => {
    if (isStill && Number.isFinite(p.options.frameTime) && p.options.frameTime >= 0 && p.options.frameTime < p.media.duration) seek(p.options.frameTime, false);
  }, [isStill, p.options.frameTime]);

  useEffect(() => {
    const previous = rangeRef.current;
    rangeRef.current = [p.options.start, p.options.end];
    if (isStill || !Number.isFinite(p.options.start) || !Number.isFinite(p.options.end)) return;
    if (previous[0] !== p.options.start) seek(p.options.start);
    else if (previous[1] !== p.options.end) seek(Math.max(p.options.start, p.options.end - 0.00001));
  }, [p.options.start, p.options.end, isStill]);

  useEffect(() => {
    if (renderingRef.current) {
      request.current++; renderingRef.current = false;
      void window.desktop.cancelPreview(); setRendering(false); p.onBusyChange(false);
    }
    setMode('source');
    setNotice(result && result.key !== key ? '参数已更新，请重新生成处理结果预览。' : '');
  }, [key]);
  useEffect(() => {
    if (!rangePlaying || !playing) return;
    let id = 0;
    const tick = () => {
      const video = sourceVideo.current;
      if (video && video.currentTime >= p.options.end - 0.002) {
        video.currentTime = p.options.start; p.onPosition(p.options.start);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [rangePlaying, playing, p.options.start, p.options.end]);
  useEffect(() => () => { request.current++; void window.desktop.cancelPreview(); p.onBusyChange(false); }, []);

  function pause() {
    sourceVideo.current?.pause(); setPlaying(false); setRangePlaying(false);
  }
  function seek(time: number, updateFrame = true) {
    const actual = frameTimeAt(p.media, time);
    pause(); setMode('source');
    p.onPosition(actual);
    if (sourceVideo.current && sourceUrl) sourceVideo.current.currentTime = actual;
    if (isStill && updateFrame) p.onFrameTime(actual);
  }
  async function play(selected = false) {
    const video = sourceVideo.current;
    if (!video || !sourceUrl || isStill) return;
    if (playing && !selected) { pause(); return; }
    setMode('source'); setRangePlaying(selected);
    if (selected) video.currentTime = Math.max(0, p.options.start);
    else if (video.currentTime >= p.media.duration - 0.01) video.currentTime = 0;
    try { await video.play(); setPlaying(true); }
    catch (error) { setSourceError(message(error)); }
  }
  function updateTime(time: number) {
    if (rangePlaying && time >= p.options.end - 0.002) {
      if (sourceVideo.current) sourceVideo.current.currentTime = p.options.start;
      p.onPosition(p.options.start);
    } else p.onPosition(Math.min(time, p.media.duration));
  }
  async function renderResult() {
    if (p.disabled || p.invalid || rendering) return;
    pause(); setResultError(''); setNotice(''); setMode('result');
    const id = ++request.current;
    const renderedKey = key;
    renderingRef.current = true; setRendering(true); p.onBusyChange(true);
    try {
      const asset = await window.desktop.resultPreview(p.options);
      if (id === request.current && renderedKey === latestKey.current) setResult({ key: renderedKey, asset });
    } catch (error) { if (id === request.current && !message(error).includes('取消')) setResultError(message(error)); }
    finally { if (id === request.current) { renderingRef.current = false; setRendering(false); p.onBusyChange(false); } }
  }
  async function cancelResult() {
    request.current++; renderingRef.current = false;
    await window.desktop.cancelPreview().catch(() => {});
    setRendering(false); p.onBusyChange(false); setMode('source'); setNotice('结果预览已取消。');
  }
  const frameNumber = frameIndex(p.media, p.currentTime) + 1;
  return <div className="preview-workspace">
    <div className="preview-toolbar"><div className="preview-tabs"><button className={mode === 'source' ? 'selected' : ''} onClick={() => setMode('source')}>原素材</button><button disabled={!resultFresh || rendering} className={mode === 'result' ? 'selected' : ''} onClick={() => { pause(); setMode('result'); }}>处理结果</button></div>
      {rendering ? <button className="preview-render-button" onClick={() => void cancelResult()}><X size={13}/>取消预览</button> : <button className="preview-render-button" disabled={p.disabled || p.invalid} onClick={() => void renderResult()}><RefreshCw size={13}/>{isStill ? '预览单帧' : '预览处理结果'}</button>}
    </div>
    <div ref={container} className={`media-preview source-preview ${mode === 'result' ? 'result-visible' : ''}`}>
      <div className="source-stage" hidden={mode !== 'source'}>
        {sourceUrl && <video ref={sourceVideo} src={sourceUrl} playsInline preload="auto" style={{ visibility: wantsFrame && frameFresh ? 'hidden' : 'visible' }}
          onLoadedMetadata={event => { event.currentTarget.currentTime = frameTimeAt(p.media, positionRef.current); }}
          onTimeUpdate={event => updateTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { if (rangePlaying) { void play(true); } else setPlaying(false); }}
          onError={() => { setSourceError('当前编码无法直接播放，请生成兼容预览。'); }} onClick={() => void play()}/>}
        {wantsFrame && frameFresh && <img className="source-frame-image" src={frame.url} alt={`原素材 ${preciseTime(frame.time ?? target)} 的帧`}/>}
        {wantsFrame && !frameFresh && (sourceUrl && !frameError ? <span className="frame-loading-badge" role="status"><LoaderCircle size={12} className="spin"/>读取 {preciseTime(target)} 的精确画面…</span> : <div className="preview-loading" role="status">{frameError ? <><Camera size={24}/><p>{frameError}</p></> : <><LoaderCircle className="spin" size={24}/><p>读取 {preciseTime(target)} 的画面…</p></>}</div>)}
        {sourceError && !wantsFrame && <div className="preview-loading"><Film size={24}/><p>{sourceError}</p><button className="secondary-button" onClick={() => { setSourceUrl(''); setSourceRevision(value => value + 1); }}>生成兼容预览</button></div>}
        {p.options.tool === 'adjust' && p.options.effects.crop && <CropOverlay container={container} media={p.media} crop={p.options.effects.crop} disabled={p.disabled} onChange={crop => p.onEffects({ ...p.options.effects, crop })}/>}
        <span className="preview-label">{isStill ? `待导出单帧 · ${preciseTime(target)}` : gif ? `GIF · 第 ${frameNumber} / ${p.media.frameTimes?.length ?? '?'} 帧` : '原始素材'}</span>
      </div>
      {mode === 'result' && (rendering ? <div className="preview-loading" role="status"><LoaderCircle className="spin" size={26}/><strong>正在生成所选范围的处理结果…</strong><p>应用当前格式、尺寸、画面调整与音频设置，可随时取消。</p></div> : resultError ? <div className="preview-loading"><p>{resultError}</p></div> : resultFresh ? <div className="result-stage" data-preview-format={result.asset.format}>
        {result.asset.format === 'png' ? <img src={result.asset.url} alt="PNG 导出结果预览"/> : result.asset.format === 'mp3' || result.asset.format === 'm4a' ? <div className="audio-result"><Music2 size={38}/><strong>音频处理结果</strong><audio controls src={result.asset.url}/></div> : <video key={result.asset.url} controls playsInline preload="auto" src={result.asset.playbackUrl || result.asset.url} loop={result.asset.format === 'gif' && p.options.loop}/>}
        <span className="preview-label">{result.asset.format.toUpperCase()} · 实际处理结果{result.asset.time !== undefined ? ` · ${preciseTime(result.asset.time)}` : ''}</span>
      </div> : <div className="preview-loading"><p>点击“预览处理结果”查看当前参数的效果。</p></div>)}
    </div>
    {mode === 'source' ? <>
      <div className="player-controls">
        <button className="icon-button" aria-label="上一帧" title="上一帧" disabled={p.currentTime <= 0} onClick={() => seek(stepFrame(p.media,p.currentTime,-1))}><SkipBack size={15}/></button>
        <button className="icon-button" aria-label={playing ? '暂停' : '播放'} disabled={!sourceUrl || sourceLoading || isStill} onClick={() => void play()}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button>
        <button className="icon-button" aria-label="下一帧" title="下一帧" disabled={p.currentTime >= stepFrame(p.media,p.media.duration,0)} onClick={() => seek(stepFrame(p.media,p.currentTime,1))}><SkipForward size={15}/></button>
        <span className="player-time">{preciseTime(p.currentTime)}</span><input className="seek-range" type="range" aria-label="预览播放位置" min={0} max={Math.max(0,p.media.duration-0.000001)} step={gif ? 0.01 : 0.001} value={p.currentTime} onChange={event => seek(Number(event.target.value))}/><span className="player-time muted">{preciseTime(p.media.duration)}</span>
      </div>
      <div className="preview-range-row"><span>{sourceLoading ? <><LoaderCircle size={12} className="spin"/>正在准备完整播放预览，仍可定位单帧</> : isStill ? '拖动时间轴或逐帧切换，右侧取帧时间同步更新' : gif ? '可暂停、定位和逐帧查看；蓝框用于原画面裁切' : '拖动时间轴定位，或播放已选范围'}</span>{!isStill && <button className={rangePlaying ? 'selected' : ''} disabled={!sourceUrl || sourceLoading || p.invalid} onClick={() => rangePlaying ? pause() : void play(true)}><Repeat2 size={12}/>{rangePlaying ? '停止片段循环' : '播放所选片段'}</button>}</div>
    </> : <div className="result-caption">确认效果后，点击“开始处理”保存正式文件。</div>}
    {notice && <div className="preview-notice" role="status">{notice}</div>}
  </div>;
}
