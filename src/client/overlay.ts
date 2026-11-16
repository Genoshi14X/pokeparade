import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import 'pixi.js/unsafe-eval';
import { connect, type State } from './connection.js';
import { WIDTH, HEIGHT, type Action, type Skin } from '../shared.js';
import { clipTiming, frameIndex, type Timing } from './animation.js';

type Clip = Timing & { textures: Texture[] };
type Frames = Record<Action, Clip>;
interface Avatar { root: Container; sprite: Sprite; label: Text; skin: string; requestedSkin: string; frames: Frames }
const app = new Application();
const errorElement = document.querySelector<HTMLElement>('#error')!;
const frameCache = new Map<string, Promise<Frames>>();
const avatars = new Map<string, Avatar>();
let latest: State | undefined;
let receivedAt = 0;

// Temporary, code-drawn pixel characters. Replace through sprites/manifest.json.
function placeholder(skin: Skin): Frames {
  const make = (pose: number) => {
    const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 24;
    const c = canvas.getContext('2d')!;
    const rect = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
    const outline = '#273341', color = skin.color || '#83e8bb';
    const lift = pose === 1 ? 1 : 0;
    rect(5, 2 + lift, 4, 6, outline); rect(15, 2 + lift, 4, 6, outline);
    rect(6, 3 + lift, 2, 5, color); rect(16, 3 + lift, 2, 5, color);
    rect(5, 7 + lift, 14, 2, outline); rect(3, 9 + lift, 18, 10, outline); rect(5, 19 + lift, 14, 3, outline);
    rect(5, 9 + lift, 14, 10, color); rect(7, 19 + lift, 10, 1, color);
    rect(6, 12 + lift, 12, 6, '#f4f4e7');
    rect(7, 12 + lift, 2, 3, outline); rect(15, 12 + lift, 2, 3, outline);
    rect(8, 12 + lift, 1, 1, '#ffffff'); rect(16, 12 + lift, 1, 1, '#ffffff');
    rect(11, 16 + lift, 2, 1, outline);
    rect(5, 16 + lift, 2, 1, '#ef9aaa'); rect(17, 16 + lift, 2, 1, '#ef9aaa');
    rect(6 + (pose === 1 ? -1 : 0), 21, 4, pose === 1 ? 2 : 3, outline);
    rect(14 + (pose === 2 ? 1 : 0), 21, 4, pose === 2 ? 2 : 3, outline);
    if (pose === 3) { rect(0, 9, 3, 4, outline); rect(21, 9, 3, 4, outline); rect(1, 9, 2, 2, color); rect(21, 9, 2, 2, color); }
    const texture = Texture.from(canvas); texture.source.scaleMode = 'nearest'; return texture;
  };
  const frames = [0, 1, 2, 3].map(make);
  const clip = (indices: number[]): Clip => ({ textures: indices.map(i => frames[i]), ...clipTiming(indices, 8) });
  return { idle: clip([0]), walk: clip([0, 1, 0, 2]), jump: clip([3]), dance: clip([3, 1, 3, 2]) };
}
function loadFrames(skin: Skin): Promise<Frames> {
  if (!frameCache.has(skin.id)) frameCache.set(skin.id, (async () => {
    if (!skin.image) return placeholder(skin);
    try {
      const sheet = await Assets.load<Texture>(skin.image);
      if (sheet.width < skin.frameWidth! * skin.columns! || sheet.height < skin.frameHeight! * skin.rows!) throw new Error('Размер изображения меньше сетки кадров');
      sheet.source.scaleMode = 'nearest';
      const frame = (index: number) => new Texture({ source: sheet.source, frame: new Rectangle((index % skin.columns!) * skin.frameWidth!, Math.floor(index / skin.columns!) * skin.frameHeight!, skin.frameWidth!, skin.frameHeight!) });
      const clip = (indices: number[]): Clip => ({ textures: indices.map(frame), ...clipTiming(indices, skin.fps || 8, skin.frameDurations) });
      const idle = clip(skin.animations?.idle || [0]);
      return { idle, walk: skin.animations?.walk ? clip(skin.animations.walk) : idle, jump: skin.animations?.jump ? clip(skin.animations.jump) : idle, dance: skin.animations?.dance ? clip(skin.animations.dance) : idle };
    } catch (error) {
      console.error(`Не удалось загрузить спрайт ${skin.id}. Используется временный персонаж.`, error);
      if (new URLSearchParams(location.search).has('preview')) errorElement.textContent = `Не удалось загрузить «${skin.name}». Проверь файл спрайта и manifest.json.`;
      return placeholder(skin);
    }
  })());
  return frameCache.get(skin.id)!;
}
async function createAvatar(id: string, skin: Skin) {
  const frames = await loadFrames(skin);
  if (!latest?.players.some(p => p.id === id) || avatars.has(id)) return;
  const root = new Container(); root.sortableChildren = true;
  const shadow = new Graphics().ellipse(0, 0, 24, 5).fill({ color: '#10221d', alpha: .2 });
  const sprite = new Sprite(frames.idle.textures[0]); sprite.anchor.set(.5, 1);
  const label = new Text({ text: '', style: { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 18, fontWeight: '600', fill: '#ffffff', stroke: { color: '#18251f', width: 4 }, dropShadow: { color: '#000000', blur: 3, distance: 1, alpha: .3 } }, resolution: 2 });
  label.anchor.set(.5, 1); root.addChild(shadow, sprite, label); app.stage.addChild(root);
  root.x = latest.players.find(p => p.id === id)!.x;
  avatars.set(id, { root, sprite, label, frames, skin: skin.id, requestedSkin: skin.id });
}
const pending = new Set<string>();
async function start() {
  await app.init({ width: WIDTH, height: HEIGHT, backgroundAlpha: 0, preference: 'webgl', antialias: false, resolution: 1 });
  document.body.prepend(app.canvas); app.stage.sortableChildren = true;
  connect(state => {
    latest = state; receivedAt = performance.now(); app.ticker.maxFPS = state.settings.fps;
    const present = new Set(state.players.map(p => p.id));
    for (const [id, avatar] of avatars) if (!present.has(id)) { avatar.root.destroy({ children: true }); avatars.delete(id); }
    for (const p of state.players) {
      if (!avatars.has(p.id) && !pending.has(p.id)) {
        pending.add(p.id);
        void createAvatar(p.id, state.skins.find(s => s.id === p.skin) || state.skins[0]).catch(error => console.error(error)).finally(() => pending.delete(p.id));
      }
      const avatar = avatars.get(p.id);
      if (avatar && avatar.requestedSkin !== p.skin) {
        avatar.requestedSkin = p.skin;
        void loadFrames(state.skins.find(s => s.id === p.skin) || state.skins[0]).then(frames => { if (avatar.requestedSkin === p.skin) { avatar.frames = frames; avatar.skin = p.skin; } });
      }
    }
  });
  app.ticker.add(ticker => {
    if (!latest) return;
    const time = latest.time + (latest.paused ? 0 : Math.min((performance.now() - receivedAt) / 1000, .2));
    const { size, bottom, names } = latest.settings;
    for (const p of latest.players) {
      const avatar = avatars.get(p.id); if (!avatar) continue;
      const { root, sprite, label, frames } = avatar;
      const moving = p.action === 'walk';
      const phase = time * 9;
      const clip = frames[p.action];
      sprite.texture = clip.textures[frameIndex(time, clip)];
      const scale = size / Math.max(sprite.texture.width, sprite.texture.height);
      const facing = latest.skins.find(s => s.id === avatar.skin)?.facing === 'left' ? -1 : 1;
      sprite.scale.set(scale * p.direction * facing, scale);
      let y = moving ? Math.abs(Math.sin(phase)) * -3 : 0;
      if (p.action === 'jump') y = -Math.sin(Math.min(1, Math.max(0, 1 - (p.until - time) / .9)) * Math.PI) * size * 1.1;
      if (p.action === 'dance') { y = -Math.abs(Math.sin(time * 10)) * 10; sprite.rotation = Math.sin(time * 12) * .16; }
      else sprite.rotation = 0;
      sprite.y = y;
      root.x += (p.x - root.x) * Math.min(1, ticker.deltaMS / 1000 * 18);
      root.y = HEIGHT - bottom - p.lane * size * .4; root.zIndex = root.y;
      label.text = p.name; label.visible = names; label.y = -size - 9 + y;
    }
  });
  // No UI is drawn on the OBS layer when the local server reconnects.
  (window as any).__stage = { app, avatars, getState: () => latest };
}
void start().catch(error => { console.error('Graphics initialization failed', error); errorElement.textContent = 'Не удалось запустить графику. Включи аппаратное ускорение источника браузера в OBS и обнови источник.'; });
