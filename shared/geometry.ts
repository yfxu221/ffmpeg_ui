import type { CropRect, ExportOptions, MediaInfo, VideoEffects } from './types';

export const NEUTRAL_EFFECTS: VideoEffects = { rotation: 0, flipH: false, flipV: false, speed: 1, crop: null };

export function cropForAspect(width: number, height: number, ratio: number): CropRect {
  const cropWidth = Math.max(1, Math.min(width, Math.round(height * ratio)));
  const cropHeight = Math.max(1, Math.min(height, Math.round(width / ratio)));
  return { x: Math.floor((width - cropWidth) / 2), y: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

export function clampCrop(crop: CropRect, width: number, height: number): CropRect {
  const cropWidth = Math.max(Math.min(16, width), Math.min(width, Math.round(crop.width)));
  const cropHeight = Math.max(Math.min(16, height), Math.min(height, Math.round(crop.height)));
  return { x: Math.max(0, Math.min(width - cropWidth, Math.round(crop.x))), y: Math.max(0, Math.min(height - cropHeight, Math.round(crop.y))), width: cropWidth, height: cropHeight };
}

export function transformedSize(media: Pick<MediaInfo, 'width' | 'height'>, effects: VideoEffects) {
  const width = effects.crop?.width ?? media.width;
  const height = effects.crop?.height ?? media.height;
  return effects.rotation % 180 ? { width: height, height: width } : { width, height };
}

export function exportDuration(options: ExportOptions) {
  return options.format === 'png' ? 0 : (options.end - options.start) / (options.tool === 'adjust' ? options.effects.speed : 1);
}

export function outputDimensions(media: MediaInfo, options: Pick<ExportOptions, 'tool' | 'format' | 'width' | 'fastTrim' | 'effects'>) {
  if (options.format === 'png' || options.fastTrim) return { width: media.width, height: media.height };
  const source = transformedSize(media, options.tool === 'adjust' ? options.effects : NEUTRAL_EFFECTS);
  if (options.format === 'gif') return { width: options.width || source.width, height: options.width ? Math.max(1, Math.round(source.height * options.width / source.width)) : source.height };
  return {
    width: Math.ceil((options.width || source.width) / 2) * 2,
    height: options.width ? Math.max(2, Math.round(source.height * options.width / source.width / 2) * 2) : Math.ceil(source.height / 2) * 2,
  };
}
