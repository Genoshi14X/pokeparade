import type { Skin } from '../shared.js';

const imagePath = (value: unknown) => typeof value === 'string' && /^\/sprites\/[a-zA-Z0-9_./-]+\.(png|webp)$/.test(value) && !value.includes('..');
export function validateSkins(value: unknown): Skin[] {
  if (!Array.isArray(value) || value.length > 2048) throw new Error('Invalid sprite catalog');
  const skins = value as Skin[];
  const valid = skins.every(s => {
    if (!s || typeof s !== 'object') return false;
    const count = (s.columns ?? 0) * (s.rows ?? 0);
    const animations = s.animations && Object.values(s.animations);
    return typeof s.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(s.id) && typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 40 &&
      imagePath(s.image) && (s.preview === undefined || imagePath(s.preview)) &&
      (s.dexNumber === undefined || (Number.isInteger(s.dexNumber) && s.dexNumber > 0 && s.dexNumber <= 1025)) &&
      (s.facing === undefined || s.facing === 'left' || s.facing === 'right') &&
      [s.frameWidth, s.frameHeight, s.columns, s.rows].every(v => Number.isInteger(v) && v! > 0 && v! <= 4096) &&
      s.frameWidth! * s.columns! <= 8192 && s.frameHeight! * s.rows! <= 8192 &&
      typeof s.fps === 'number' && s.fps > 0 && s.fps <= 60 &&
      animations && animations.length > 0 && animations.every(frames => Array.isArray(frames) && frames.length > 0 && frames.length <= 4096 && frames.every(f => Number.isInteger(f) && f >= 0 && f < count)) &&
      (s.frameDurations === undefined || (Array.isArray(s.frameDurations) && s.frameDurations.length > 0 && s.frameDurations.length <= count && s.frameDurations.every(ms => Number.isFinite(ms) && ms >= 10 && ms <= 60000) && animations.every(frames => frames!.every(f => f < s.frameDurations!.length))));
  });
  const numbers = skins.filter(s => s?.dexNumber !== undefined).map(s => s.dexNumber);
  if (!valid || new Set(skins.map(s => s.id)).size !== skins.length || new Set(numbers).size !== numbers.length) throw new Error('Invalid sprite manifest');
  return skins;
}
