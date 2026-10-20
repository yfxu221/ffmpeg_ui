import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from 'lucide-react';
import type { CropRect, MediaInfo, VideoEffects } from '../shared/types';
import { clampCrop, cropForAspect, NEUTRAL_EFFECTS } from '../shared/geometry';

export function cropIsValid(crop: CropRect | null, media: MediaInfo | null) {
  return !crop || Boolean(media && [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) && crop.x >= 0 && crop.y >= 0 && crop.width >= 16 && crop.height >= 16 && crop.x + crop.width <= media.width && crop.y + crop.height <= media.height);
}

export function AdjustmentPanel({ media, effects, disabled, onChange }: {
  media: MediaInfo; effects: VideoEffects; disabled: boolean; onChange: (effects: VideoEffects) => void;
}) {
  const patch = (value: Partial<VideoEffects>) => onChange({ ...effects, ...value });
  return <fieldset className="adjustment-panel" disabled={disabled}>
    <div className="adjustment-heading"><strong><RotateCw size={14}/>画面调整</strong><button onClick={() => onChange({ ...NEUTRAL_EFFECTS })}><RotateCcw size={12}/>全部重置</button></div>
    <div className="adjust-row"><span>顺时针旋转</span><div className="segmented-buttons">{([0, 90, 180, 270] as const).map(value => <button key={value} aria-label={`旋转 ${value} 度`} className={effects.rotation === value ? 'selected' : ''} onClick={() => patch({ rotation: value })}>{value}°</button>)}</div></div>
    <div className="adjust-row"><span>镜像翻转</span><div className="mirror-buttons"><button aria-pressed={effects.flipH} className={effects.flipH ? 'selected' : ''} onClick={() => patch({ flipH: !effects.flipH })}><FlipHorizontal2 size={14}/>水平</button><button aria-pressed={effects.flipV} className={effects.flipV ? 'selected' : ''} onClick={() => patch({ flipV: !effects.flipV })}><FlipVertical2 size={14}/>垂直</button></div></div>
    <label className="switch-row crop-switch"><span><Crop size={15}/>裁切画面</span><input aria-label="启用画面裁切" type="checkbox" checked={Boolean(effects.crop)} disabled={disabled || media.width < 16 || media.height < 16} onChange={event => patch({ crop: event.target.checked ? { x: 0, y: 0, width: media.width, height: media.height } : null })}/><i className="switch"/></label>
    {effects.crop && <>
      <div className="crop-preset-row"><select aria-label="裁切比例预设" value="" onChange={event => { const ratio = Number(event.target.value); patch({ crop: ratio ? cropForAspect(media.width, media.height, ratio) : { x: 0, y: 0, width: media.width, height: media.height } }); }}><option value="" disabled>应用比例预设</option><option value="0">完整画面</option><option value="1">1 : 1 正方形</option><option value={16/9}>16 : 9 横屏</option><option value={9/16}>9 : 16 竖屏</option><option value={4/3}>4 : 3 横屏</option></select><small>像素坐标基于原画面</small></div>
      <div className="crop-fields">{([{ key:'x', label:'左侧 X' },{ key:'y', label:'顶部 Y' },{ key:'width', label:'宽度' },{ key:'height', label:'高度' }] as const).map(item => <label key={item.key}><span>{item.label}</span><input aria-label={`裁切${item.label}`} type="number" min={item.key === 'x' || item.key === 'y' ? 0 : 16} max={item.key === 'x' || item.key === 'width' ? media.width : media.height} step={1} value={effects.crop![item.key]} onChange={event => patch({ crop: { ...effects.crop!, [item.key]: Number(event.target.value) } })}/></label>)}</div>
      {!cropIsValid(effects.crop, media) && <p className="inline-error">裁切范围须在原画面内，宽高至少为 16 像素。</p>}
    </>}
    <p className="adjustment-note">预览显示原始画面与裁切范围，可拖动蓝框或角点自由调整。导出顺序：裁切 → 旋转 → 镜像 → 缩放。</p>
  </fieldset>;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type DragState = { mode: 'move' | 'draw' | Corner; x: number; y: number; crop: CropRect };

export function CropOverlay({ container, media, crop, disabled, onChange }: {
  container: RefObject<HTMLDivElement | null>; media: MediaInfo; crop: CropRect;
  disabled: boolean; onChange: (crop: CropRect) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<DragState | null>(null);
  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    const update = () => {
      const scale = Math.min(parent.clientWidth / media.width, parent.clientHeight / media.height);
      setSize({ width: media.width * scale, height: media.height * scale });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(parent);
    return () => observer.disconnect();
  }, [container, media.width, media.height]);
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(media.width, Math.round((event.clientX - bounds.left) / bounds.width * media.width))), y: Math.max(0, Math.min(media.height, Math.round((event.clientY - bounds.top) / bounds.height * media.height))) };
  };
  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = position(event);
    const target = event.target as HTMLElement;
    const mode = (target.dataset.corner || (target.closest('.crop-rectangle') ? 'move' : 'draw')) as DragState['mode'];
    drag.current = { mode, ...point, crop: clampCrop(crop, media.width, media.height) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || disabled) return;
    const point = position(event);
    const dx = point.x - state.x, dy = point.y - state.y;
    let next: CropRect;
    if (state.mode === 'move') next = { ...state.crop, x: state.crop.x + dx, y: state.crop.y + dy };
    else if (state.mode === 'draw') next = { x: Math.min(state.x, point.x), y: Math.min(state.y, point.y), width: Math.abs(dx), height: Math.abs(dy) };
    else {
      const left = state.mode.includes('w') ? Math.min(point.x, state.crop.x + state.crop.width - 16) : state.crop.x;
      const top = state.mode.includes('n') ? Math.min(point.y, state.crop.y + state.crop.height - 16) : state.crop.y;
      const right = state.mode.includes('e') ? Math.max(point.x, state.crop.x + 16) : state.crop.x + state.crop.width;
      const bottom = state.mode.includes('s') ? Math.max(point.y, state.crop.y + 16) : state.crop.y + state.crop.height;
      next = { x: left, y: top, width: right - left, height: bottom - top };
    }
    onChange(clampCrop(next, media.width, media.height));
  }
  const visible = clampCrop(crop, media.width, media.height);
  return <div className={`crop-layer ${disabled ? 'locked' : ''}`} style={size} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} aria-label="原画面裁切区域">
    <div className="crop-rectangle" style={{ left: `${visible.x / media.width * 100}%`, top: `${visible.y / media.height * 100}%`, width: `${visible.width / media.width * 100}%`, height: `${visible.height / media.height * 100}%` }}><div className="crop-thirds"/>{(['nw','ne','sw','se'] as const).map(corner => <span key={corner} className={`crop-handle ${corner}`} data-corner={corner}/>)}<span className="crop-dimensions">{visible.width} × {visible.height}</span></div>
  </div>;
}
