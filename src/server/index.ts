import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Scene } from './scene.js';
import { Twitch, type Credentials } from './twitch.js';
import { validateSkins } from './skins.js';
import { DEFAULT_SKINS, type Skin } from '../shared.js';

const port = Number(process.env.PORT || 3187);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535');
const origin = `http://127.0.0.1:${port}`;
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const dataDir = resolve(process.env.STAGE_DATA_DIR || '.data');
await mkdir(dataDir, { recursive: true });
async function readJson(name: string, fallback: any): Promise<any> {
  try { return JSON.parse(await readFile(resolve(dataDir, name), 'utf8')); }
  catch (error: any) {
    if (error.code !== 'ENOENT') {
      const backup = `${name}.invalid-${Date.now()}`;
      await rename(resolve(dataDir, name), resolve(dataDir, backup)).catch(() => {});
      console.warn(`${name}: could not read saved data; using defaults. Check ${backup} for a backup.`);
    }
    return fallback;
  }
}
let writes = Promise.resolve();
function save(name: string, data: unknown) {
  const contents = JSON.stringify(data, null, 2);
  const operation = writes.catch(() => {}).then(async () => {
    const target = resolve(dataDir, name);
    await writeFile(`${target}.tmp`, contents, { mode: 0o600 }); await rename(`${target}.tmp`, target);
  });
  writes = operation; return operation;
}
let skins: Skin[] = DEFAULT_SKINS;
try {
  const manifest = JSON.parse(await readFile(resolve(publicDir, 'sprites/manifest.json'), 'utf8'));
  if (Array.isArray(manifest.skins) && manifest.skins.length) {
    skins = validateSkins(manifest.skins);
  }
} catch (error: any) { if (error.code !== 'ENOENT') console.warn('Sprite manifest invalid. Using built-in characters.'); }
const stored = await readJson('scene.json', {});
const scene = new Scene(stored.settings || {}, stored.profiles && typeof stored.profiles === 'object' ? stored.profiles : {}, skins);
let persistTimer: ReturnType<typeof setTimeout>;
scene.onPersist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => { void save('scene.json', { settings: scene.settings, profiles: scene.profiles }).catch(() => console.warn('Could not save scene settings. Check disk access.')); }, 300); };
const twitch = new Twitch((id, name, text) => scene.command(id, name, text), async credentials => { await save('twitch.json', credentials ?? null); });
const credentials: Credentials | null = await readJson('twitch.json', null);
if (credentials?.accessToken && credentials.refreshToken && credentials.clientId) void twitch.connect(credentials);

function snapshot(includeCatalog = true) { return { ...scene.snapshot(), skins: includeCatalog ? scene.skins : undefined, twitch: twitch.status }; }
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:${port}; frame-ancestors 'self'`);
  const json = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': mime['.json'] }); res.end(JSON.stringify(data)); };
  if (req.headers.host !== `127.0.0.1:${port}`) { json(403, { error: `Открой ${origin}` }); return; }
  try {
    const url = new URL(req.url!, origin);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'GET' && url.pathname === '/api/state') { json(200, snapshot()); return; }
      if (req.method !== 'POST') { json(405, { error: 'Метод не поддерживается' }); return; }
      if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) { json(403, { error: 'Открой панель управления заново.' }); return; }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8192) { json(413, { error: 'Слишком большой запрос' }); return; } }
      const body = JSON.parse(raw || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Не удалось прочитать запрос. Обнови панель и повтори действие.');
      switch (url.pathname) {
        case '/api/demo': scene.demo(Math.max(1, Math.min(40, Number(body.count) || 1))); break;
        case '/api/clear': scene.clear(body.demoOnly === true); break;
        case '/api/pause': scene.paused = body.paused === true; break;
        case '/api/settings': scene.updateSettings(body); break;
        case '/api/remove': if (typeof body.id === 'string') scene.leave(body.id); break;
        case '/api/skin': {
          if (typeof body.id !== 'string' || typeof body.skin !== 'string' || !scene.setSkin(body.id, body.skin)) throw new Error('Персонаж или покемон не найден. Обнови список и повтори выбор.');
          break;
        }
        case '/api/action': {
          const allowed = ['!jump', '!dance'];
          if (!allowed.includes(body.command)) throw new Error('Действие недоступно');
          for (const p of scene.players.values()) if (!body.id || body.id === p.id) scene.command(p.id, p.name, body.command);
          break;
        }
        case '/api/twitch/connect': await twitch.authorize(String(body.clientId || '').trim()); break;
        case '/api/twitch/disconnect': await twitch.logout(); break;
        default: json(404, { error: 'Действие не найдено' }); return;
      }
      json(200, snapshot()); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, { error: 'Метод не поддерживается' }); return; }
    const route = url.pathname === '/' ? 'index.html' : url.pathname === '/overlay' ? 'overlay.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
    const target = resolve(publicDir, route);
    if (!target.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep)) { json(403, { error: 'Недоступно' }); return; }
    try {
      const contents = await readFile(target);
      res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : contents);
    } catch { json(404, { error: 'Файл не найден' }); }
  } catch (error) { json(400, { error: error instanceof Error && !/fetch|JSON|Unexpected|ENOENT|timeout/i.test(error.message) ? error.message : 'Не удалось выполнить действие. Попробуй ещё раз.' }); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
server.on('upgrade', (req, socket, head) => {
  if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin !== origin || req.url !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, req); });
});
wss.on('connection', ws => { ws.send(JSON.stringify(snapshot())); });
let last = performance.now(), broadcasts = 0;
const timer = setInterval(() => {
  const now = performance.now(); scene.tick(Math.min((now - last) / 1000, .1)); last = now;
  if (++broadcasts % 3) return;
  // Atlases and the catalog do not change during a session: send metadata only on connect.
  const data = JSON.stringify(snapshot(false));
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) {
    if (ws.bufferedAmount > 1_000_000) { ws.terminate(); continue; }
    ws.send(data);
  }
}, 1000 / 30);
server.on('error', error => { console.error(`Не удалось запустить сцену: ${error.message}. Проверь, не запущена ли она уже.`); process.exitCode = 1; clearInterval(timer); twitch.stop(); });
server.listen(port, '127.0.0.1', () => { console.log(`\nPokéParade\nПанель: ${origin}\nOBS:    ${origin}/overlay\nРазмер: 1920 × 1080\nОстановить: Ctrl+C\n`); });
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  clearInterval(timer); clearTimeout(persistTimer); twitch.stop();
  await save('scene.json', { settings: scene.settings, profiles: scene.profiles }).catch(() => {});
  for (const ws of wss.clients) ws.terminate(); wss.close(); server.close();
}
process.on('SIGINT', () => { void shutdown(); }); process.on('SIGTERM', () => { void shutdown(); });
