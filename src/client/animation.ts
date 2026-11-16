export interface Timing { ends: number[]; duration: number }
export function clipTiming(indices: number[], fps: number, frameDurations?: number[]): Timing {
  let duration = 0;
  const ends = indices.map(index => { duration += frameDurations?.[index] ?? 1000 / fps; return duration; });
  return { ends, duration };
}
export function frameIndex(seconds: number, timing: Timing): number {
  const elapsed = ((seconds * 1000 % timing.duration) + timing.duration) % timing.duration;
  const index = timing.ends.findIndex(end => elapsed < end);
  return index < 0 ? timing.ends.length - 1 : index;
}
