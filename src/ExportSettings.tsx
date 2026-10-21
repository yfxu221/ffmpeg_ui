import type { ReactNode } from 'react';
import { Camera, Check, ChevronDown, Film, Gauge, Image, Music2, RotateCcw, Settings2, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react';
import type { ExportOptions, MediaInfo, OutputFormat, Tool, VideoEffects } from '../shared/types';
import { outputDimensions, transformedSize, NEUTRAL_EFFECTS } from '../shared/geometry';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><div className="field-heading"><span>{label}</span>{hint && <small>{hint}</small>}</div>{children}</div>;
}
interface Props {
  media: MediaInfo | null; tool: Tool; format: OutputFormat; width: number; fps: number;
  quality: ExportOptions['quality']; mute: boolean; loop: boolean; fastTrim: boolean;
  effects: VideoEffects; frameTime: number; duration: number; busy: boolean; canUseCurrent: boolean;
  onFormat: (value: OutputFormat) => void; onWidth: (value: number) => void; onFps: (value: number) => void;
  onQuality: (value: ExportOptions['quality']) => void; onMute: (value: boolean) => void;
  onLoop: (value: boolean) => void; onFastTrim: (value: boolean) => void; onSpeed: (value: number) => void;
  onFrameTime: (value: number) => void; onUseCurrent: () => void;
}

export default function ExportSettings(p: Props) {
  const extraction = p.tool === 'extract';
  const still = p.format === 'png';
  const dimensions = p.media ? outputDimensions(p.media, p) : null;
  const sourceSize = p.media ? transformedSize(p.media, p.tool === 'adjust' ? p.effects : NEUTRAL_EFFECTS) : null;
  const widthChoices = [...new Set([320, 480, 640, 960, 1280, 1920, ...(p.width ? [p.width] : [])])].sort((a,b) => a-b);
  const labels: Record<OutputFormat, string> = { mp4: 'MP4 视频', gif: 'GIF 动画', mp3: 'MP3 音频', m4a: 'M4A 音频', png: 'PNG 单帧' };
  return <aside className="options-card">
    <div className="card-heading"><div><Settings2 size={16}/><strong>导出设置</strong></div><span className="small-label">{{ convert:'CONVERT', trim:'TRIM', compress:'OPTIMIZE', adjust:'ADJUST', extract:'EXTRACT' }[p.tool]}</span></div>
    <fieldset disabled={p.busy} className="options-fields">
      <Field label={extraction ? '提取类型' : '输出格式'}>
        {extraction ? <div className="extract-formats">{(['mp3','m4a','png'] as const).map(value => <button key={value} aria-label={`提取 ${value.toUpperCase()}`} disabled={value !== 'png' && Boolean(p.media && !p.media.hasAudio)} className={p.format === value ? 'selected' : ''} onClick={() => p.onFormat(value)}>{value === 'png' ? <Camera size={16}/> : <Music2 size={16}/>}<span>{value.toUpperCase()}</span></button>)}</div> : <div className="format-toggle">{(['mp4','gif'] as const).map(value => <button key={value} className={p.format === value ? 'selected' : ''} disabled={p.tool !== 'convert' && Boolean(p.media && p.media.format !== value)} onClick={() => p.onFormat(value)}>{value === 'mp4' ? <Film size={16}/> : <Image size={16}/>}<span>{value.toUpperCase()}</span>{p.format === value && <Check size={13}/>}</button>)}</div>}
        <p className="field-hint">{extraction ? still ? '将指定时间的一帧保存为无损图片' : p.media && !p.media.hasAudio ? '这个素材没有音轨，可选择 PNG 单帧' : '提取第一条音轨，支持下方的时间范围' : p.format === 'gif' ? '轻巧的动态画面，适合分享与展示' : 'H.264 视频，兼顾画质与播放兼容性'}</p>
      </Field>
      {extraction ? still ? <>
        <Field label="取帧时间" hint="原素材中的秒数"><div className="frame-time-input"><input aria-label="取帧时间（秒）" type="number" min={0} max={p.media ? Math.max(0, p.media.duration - 0.001) : 0} step={0.001} value={p.frameTime} onChange={event => p.onFrameTime(Number(event.target.value))}/><span>秒</span></div></Field>
        <button className="secondary-button use-current-frame" disabled={!p.media || !p.canUseCurrent || p.busy} onClick={p.onUseCurrent}><Camera size={14}/>使用当前预览位置</button>
        <p className="field-hint">拖动左侧时间轴、逐帧切换或输入时间，画面同步定位。GIF 按真实帧时间取帧。</p>
      </> : <div className="audio-extract-note"><Music2 size={22}/><strong>{p.format === 'mp3' ? 'MP3 · 高质量可变码率' : 'AAC · 192 kbps'}</strong><p>仅导出音频，不包含视频。开始与结束时间沿用左侧处理范围。</p></div> : <>
        {p.tool === 'trim' && p.media?.format === 'mp4' && <div className="fast-trim-option"><label className="switch-row"><span><Zap size={14}/>快速截取</span><input type="checkbox" checked={p.fastTrim} onChange={event => p.onFastTrim(event.target.checked)}/><i className="switch"/></label><p className="field-hint">{p.fastTrim ? '直接复制视频流，起止位置可能偏移；忽略尺寸、帧率与画质设置。' : '默认精确截取，重新编码所选片段。'}</p></div>}
        {p.tool === 'adjust' && <Field label="播放倍速" hint="音频同步，保留音调"><div className="select-wrap"><Gauge size={14} className="speed-symbol"/><select className="speed-select" aria-label="播放倍速" value={p.effects.speed} onChange={event => p.onSpeed(Number(event.target.value))}>{[0.25,0.5,0.75,1,1.25,1.5,2,3,4].map(value => <option key={value} value={value}>{value}×{value === 1 ? ' · 原速' : ''}</option>)}</select><ChevronDown size={14}/></div><p className="field-hint">改变播放速度会改变导出时长；预览仍按原素材播放。</p></Field>}
        <div className={p.fastTrim ? 'disabled-fields' : ''}>
          <Field label="输出尺寸" hint="保持宽高比"><div className="select-wrap"><select aria-label="输出尺寸" value={p.width} disabled={p.busy || p.fastTrim} onChange={event => p.onWidth(Number(event.target.value))}><option value={0}>原始尺寸{sourceSize ? ` · ${sourceSize.width} px` : ''}</option>{widthChoices.map(value => <option key={value} value={value}>{value} px 宽{value === 640 && p.format === 'gif' ? ' · 推荐 GIF' : ''}</option>)}</select><ChevronDown size={14}/></div></Field>
          <Field label="帧率" hint={p.format === 'gif' ? '影响流畅度与体积' : '每秒画面数'}><div className="select-wrap"><select aria-label="输出帧率" value={p.fps} disabled={p.busy || p.fastTrim} onChange={event => p.onFps(Number(event.target.value))}><option value={0}>跟随原始素材</option>{[10,12,15,20,24,25,30,60].map(value => <option key={value} value={value}>{value} fps{value === 15 && p.format === 'gif' ? ' · 推荐' : ''}</option>)}</select><ChevronDown size={14}/></div></Field>
          {p.format === 'mp4' && <Field label="画质预设"><div className="quality-options">{([{id:'high',label:'高清'}, {id:'balanced',label:'均衡'}, {id:'small',label:'更小'}] as const).map(item => <button key={item.id} disabled={p.busy || p.fastTrim} className={p.quality === item.id ? 'selected' : ''} onClick={() => p.onQuality(item.id)}>{item.label}</button>)}</div><p className="field-hint">{p.quality === 'high' ? '保留更多细节，文件相对较大' : p.quality === 'small' ? '优先减小体积，画面细节有所减少' : '画面细节与文件体积之间的平衡'}</p></Field>}
        </div>
        <div className="option-divider"/>
        {p.format === 'gif' ? <label className="switch-row"><span><RotateCcw size={15}/>循环播放</span><input type="checkbox" checked={p.loop} onChange={event => p.onLoop(event.target.checked)}/><i className="switch"/></label> : <label className="switch-row"><span>{p.mute ? <VolumeX size={15}/> : <Volume2 size={15}/>}移除音频</span><input type="checkbox" checked={p.mute} onChange={event => p.onMute(event.target.checked)}/><i className="switch"/></label>}
      </>}
      <div className="output-summary"><div className="summary-icon">{extraction ? still ? <Camera size={18}/> : <Music2 size={18}/> : p.format === 'gif' ? <Image size={18}/> : <Film size={18}/>}</div><div><strong>{labels[p.format]}</strong><span>{!p.media ? '导入素材后显示输出信息' : extraction && !still ? `${p.duration.toFixed(2)} 秒 · 仅音频` : still ? `${dimensions!.width} × ${dimensions!.height} · ${p.frameTime.toFixed(3)} 秒处` : `${dimensions!.width} × ${dimensions!.height} · ${p.duration.toFixed(2)} 秒`}</span></div></div>
      <div className="tips-box"><Sparkles size={14}/><p>{extraction ? still ? 'PNG 保留原始画面分辨率。时间定位选取该时刻可解码的视频帧。' : '音频会重新编码，原文件保留；文件没有音轨时可改为提取单帧。' : p.format === 'gif' ? 'GIF 越长、尺寸越大，文件也会越大。短片段搭配 15 fps 通常更合适。' : p.tool === 'compress' ? '压缩后的大小取决于素材。选择较小尺寸或“更小”画质，通常更省空间。' : '导出自动适配偶数尺寸，方便在常见播放器和平台中使用。'}</p></div>
    </fieldset>
  </aside>;
}
