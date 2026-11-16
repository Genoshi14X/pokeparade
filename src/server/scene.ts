import { DEFAULT_SETTINGS, DEFAULT_SKINS, MAX_PLAYERS, WIDTH, type Settings, type Player, type Profile, type SceneState, type Skin } from '../shared.js';

export class Scene {
  players = new Map<string, Player>();
  queue = new Map<string, { id: string; name: string }>();
  profiles: Record<string, Profile>;
  settings: Settings;
  skins: Skin[];
  paused = false;
  time = 0;
  revision = 0;
  cooldowns = new Map<string, number>();
  onPersist = () => {};
  constructor(settings: Partial<Settings> = {}, profiles: Record<string, Profile> = {}, skins = DEFAULT_SKINS, private random = Math.random) {
    this.settings = { ...DEFAULT_SETTINGS }; this.updateSettings(settings);
    this.profiles = profiles; this.skins = skins;
  }
  snapshot(): SceneState { return { players: [...this.players.values()], queue: [...this.queue.values()], settings: this.settings, paused: this.paused, time: this.time, skins: this.skins, revision: this.revision }; }
  join(id: string, name: string, demo = false): string {
    if (this.players.has(id)) { this.players.get(id)!.lastActive = Date.now(); return 'already'; }
    if (this.players.size >= MAX_PLAYERS) {
      if (!demo && this.queue.size < 200) this.queue.set(id, { id, name });
      return 'queued';
    }
    const saved = this.profiles[id]?.skin;
    const regular = this.skins.filter(s => !s.shiny);
    const choices = regular.length ? regular : this.skins;
    const skin = this.skins.find(s => s.id === saved)?.id ?? choices[Math.floor(this.random() * choices.length)].id;
    this.players.set(id, { id, name: name.slice(0, 30), skin, x: 60 + this.random() * (WIDTH - 120), lane: Math.floor(this.random() * 3), direction: this.random() > .5 ? 1 : -1, action: 'idle', until: this.time + 1 + this.random() * 3, lastActive: Date.now(), demo });
    if (!demo) { this.profiles[id] = { skin, name }; this.onPersist(); }
    this.revision++; return 'joined';
  }
  leave(id: string) {
    // A leave/join cycle must not bypass the short cooldown on shiny attempts.
    this.players.delete(id); this.queue.delete(id);
    this.promote(); this.revision++;
  }
  promote() {
    while (this.players.size < MAX_PLAYERS && this.queue.size) {
      const entry = this.queue.entries().next().value!;
      this.queue.delete(entry[0]); this.join(entry[0], entry[1].name);
    }
  }
  clear(demoOnly = false) {
    if (!demoOnly) { this.queue.clear(); this.cooldowns.clear(); }
    for (const [id, p] of this.players) if (!demoOnly || p.demo) { this.players.delete(id); this.cooldowns.delete(id); }
    this.promote(); this.revision++;
  }
  demo(count: number) {
    const names = ['pixel_fox', 'чайный_маг', 'mooncat', 'сонный_кит', 'neon_bun', 'minty', 'лунный_кот', 'peachy', 'cosmo', 'tiny_hero'];
    for (let i = 0; i < count && this.players.size < MAX_PLAYERS; i++) {
      let id = 1; while (this.players.has(`demo:${id}`)) id++;
      this.join(`demo:${id}`, `${names[(id - 1) % names.length]}${id > 10 ? `_${id}` : ''}`, true);
    }
  }
  setSkin(id: string, selection: string, fromChat = false): boolean {
    const player = this.players.get(id);
    const key = selection.trim().toLowerCase();
    const numeric = /^\d+$/.test(key);
    let skin = this.skins.find(s => s.id === key || s.name.toLowerCase() === key) ??
      this.skins.find(s => !s.shiny && s.dexNumber === Number(key)) ??
      (!this.skins.some(s => s.dexNumber !== undefined) ? this.skins[Number(key) - 1] : undefined);
    if (!player || !skin) return false;
    // Only a valid numeric chat command rolls for shiny. Admins can select either variant.
    if (fromChat && skin.shiny) return false;
    if (fromChat && numeric && skin.dexNumber && this.settings.shinyOdds > 0) {
      const shiny = this.skins.find(s => s.shiny && s.dexNumber === skin!.dexNumber);
      if (shiny && this.random() < 1 / this.settings.shinyOdds) skin = shiny;
    }
    player.skin = skin.id;
    if (!player.demo) { this.profiles[id] = { name: player.name, skin: skin.id }; this.onPersist(); }
    this.revision++; return true;
  }
  command(id: string, name: string, message: string) {
    const [command, argument] = message.trim().toLowerCase().split(/\s+/);
    if (command === '!leave') { this.leave(id); return; }
    if (command === '!join') { this.join(id, name); return; }
    if (!this.players.has(id) && this.settings.autoJoin) this.join(id, name);
    const player = this.players.get(id); if (!player) return;
    player.lastActive = Date.now();
    if (!['!jump', '!dance', '!skin'].includes(command)) return;
    if ((this.cooldowns.get(id) ?? 0) > Date.now()) return;
    if (command === '!skin') {
      if (!argument || !this.setSkin(id, argument, true)) return;
    } else {
      player.action = command === '!jump' ? 'jump' : 'dance';
      player.until = this.time + (player.action === 'jump' ? .9 : 3);
    }
    this.cooldowns.set(id, Date.now() + 2500); this.revision++;
  }
  updateSettings(input: Partial<Settings>) {
    for (const [key, min, max] of [['size', 36, 120], ['bottom', 0, 500], ['speed', 15, 180], ['idleMinutes', 0, 240], ['shinyOdds', 0, 8192]] as const) {
      if (typeof input[key] === 'number' && Number.isFinite(input[key])) this.settings[key] = Math.round(Math.min(max, Math.max(min, input[key]!)));
    }
    for (const key of ['names', 'autoJoin'] as const) if (typeof input[key] === 'boolean') this.settings[key] = input[key]!;
    if (input.fps === 30 || input.fps === 60) this.settings.fps = input.fps;
    this.revision++; this.onPersist?.();
  }
  tick(dt: number, now = Date.now()) {
    // Inactivity is real time; animation time stops while the scene is paused.
    for (const [id, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(id);
    for (const [id, p] of this.players) {
      if (!p.demo && this.settings.idleMinutes > 0 && now - p.lastActive > this.settings.idleMinutes * 60_000) this.leave(id);
    }
    if (this.paused) return;
    this.time += dt;
    const margin = this.settings.size / 2 + 12;
    for (const p of this.players.values()) {
      if (this.time >= p.until) {
        p.action = p.action === 'walk' ? 'idle' : 'walk';
        p.until = this.time + 1.5 + this.random() * 5;
        if (p.action === 'walk') p.direction = this.random() > .5 ? 1 : -1;
      }
      if (p.action === 'walk') p.x += p.direction * this.settings.speed * dt;
      if (p.x < margin || p.x > WIDTH - margin) { p.x = Math.max(margin, Math.min(WIDTH - margin, p.x)); p.direction *= -1; }
    }
  }
}
