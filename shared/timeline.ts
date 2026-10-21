import type { MediaInfo } from './types';

export function frameIndex(media: MediaInfo, time: number): number {
  const times = media.frameTimes;
  if (!times?.length) return Math.max(0, Math.floor(time * (media.fps || 25) + 1e-6));
  let left = 0, right = times.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (times[mid] <= time + 1e-9) left = mid + 1; else right = mid;
  }
  return Math.max(0, left - 1);
}
export function frameTimeAt(media: MediaInfo, time: number): number {
  const bounded = Math.max(0, Math.min(Math.max(0, media.duration - 0.000001), time));
  return media.frameTimes?.[frameIndex(media, bounded)] ?? bounded;
}
export function stepFrame(media: MediaInfo, time: number, direction: number): number {
  if (media.frameTimes?.length) return media.frameTimes[Math.max(0, Math.min(media.frameTimes.length - 1, frameIndex(media, time) + direction))];
  return Math.max(0, Math.min(Math.max(0, media.duration - 1 / (media.fps || 25)), time + direction / (media.fps || 25)));
}
