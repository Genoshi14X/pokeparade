import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), 'pokeparade-test-'));
await mkdir('test-results', { recursive: true });
let server, browser, output = '';
const errors = [];
const spriteErrors = [];
async function launchServer() {
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), STAGE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(`${origin}/api/state`); if (response.ok) return; } catch {}
    if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${output}`);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM'); await exited;
}
try {
  await launchServer();
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) { console.error('Browser:', message.text()); spriteErrors.push(message.text()); }
  });
  await page.goto(origin);
  await page.locator('#server-status').filter({ hasText: 'Приложение запущено' }).waitFor();
  assert.equal(await page.locator('#count').innerText(), '0');
  const initial = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(initial.skins.length, 151);
  assert.equal(initial.skins[24].id, 'pikachu');
  await page.click('#open-catalog');
  await page.locator('#catalog-search').fill('25');
  await page.locator('.catalog-item:not([hidden])').filter({ hasText: 'Pikachu' }).waitFor();
  assert.equal(await page.locator('.catalog-item:not([hidden])').count(), 1);
  await page.locator('.catalog-item:not([hidden])').click();
  assert.equal(await page.locator('#catalog-command').inputValue(), '!skin pikachu');
  await page.screenshot({ path: 'test-results/pokemon-catalog.png', fullPage: true });
  await page.click('#close-catalog');
  await page.screenshot({ path: 'test-results/empty.png', fullPage: true });
  await page.click('#first-demo');
  await page.waitForFunction(() => document.querySelector('#count').textContent === '5');
  const preview = page.frameLocator('#preview-frame');
  await preview.locator('canvas').waitFor();
  const frame = page.frames().find(frame => frame.url().includes('/overlay'));
  await frame.waitForFunction(() => window.__stage?.avatars.size === 5);
  await page.locator('.player-face').first().click();
  await page.locator('#catalog-search').fill('pikachu');
  await page.locator('.catalog-item:not([hidden])').click();
  await frame.waitForFunction(() => window.__stage.avatars.get('demo:1').skin === 'pikachu');
  assert.ok(await frame.evaluate(() => window.__stage.avatars.get('demo:1').frames.idle.textures.length > 1), 'Actual animated atlas must load instead of placeholder');
  // Skin loading is asynchronous. Rapid selection must finish on the final choice.
  await page.evaluate(async () => {
    for (const skin of ['charizard', 'mew', 'pikachu']) {
      await fetch('/api/skin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'demo:1', skin }) });
    }
  });
  await frame.waitForFunction(() => window.__stage.avatars.get('demo:1').skin === 'pikachu' && window.__stage.avatars.get('demo:1').requestedSkin === 'pikachu');
  await page.click('#pause');
  await frame.waitForFunction(() => window.__stage.getState().paused);
  const pokemonTexture = await frame.evaluate(() => {
    const avatar = window.__stage.avatars.get('demo:1');
    return { source: avatar.sprite.texture.source.uid, x: avatar.sprite.texture.frame.x, y: avatar.sprite.texture.frame.y };
  });
  await page.waitForTimeout(200);
  assert.deepEqual(await frame.evaluate(() => {
    const avatar = window.__stage.avatars.get('demo:1');
    return { source: avatar.sprite.texture.source.uid, x: avatar.sprite.texture.frame.x, y: avatar.sprite.texture.frame.y };
  }), pokemonTexture, 'Pausing must freeze the Pokémon animation');
  await page.click('#pause');
  await frame.waitForFunction(previous => {
    const texture = window.__stage.avatars.get('demo:1').sprite.texture;
    return texture.frame.x !== previous.x || texture.frame.y !== previous.y;
  }, pokemonTexture);
  await page.screenshot({ path: 'test-results/stage.png', fullPage: true });
  await page.click('#fill-demo');
  await frame.waitForFunction(() => window.__stage?.avatars.size === 40);
  assert.equal(await page.locator('.player').count(), 40);
  assert.equal(await frame.evaluate(() => window.__stage.app.stage.children.length), 40);
  assert.equal(await frame.evaluate(() => [...window.__stage.avatars.values()].every(a => a.frames.idle.textures.length > 1)), true);
  await frame.waitForFunction(() => window.__stage.getState().players.some(p => p.action === 'walk'));
  const moving = await frame.evaluate(() => window.__stage.getState().players.find(p => p.action === 'walk'));
  await frame.waitForFunction(({ id, x }) => Math.abs(window.__stage.getState().players.find(p => p.id === id).x - x) > 3, moving);
  await page.click('#pause');
  await frame.waitForFunction(() => window.__stage.getState().paused);
  const paused = await frame.evaluate(() => JSON.stringify({ players: window.__stage.getState().players, time: window.__stage.getState().time }));
  await page.waitForTimeout(300);
  assert.equal(await frame.evaluate(() => JSON.stringify({ players: window.__stage.getState().players, time: window.__stage.getState().time })), paused);
  await page.click('#pause');
  await frame.waitForFunction(() => !window.__stage.getState().paused);
  await page.click('#dance-all');
  await frame.waitForFunction(() => window.__stage.getState().players.every(p => p.action === 'dance'));
  await page.screenshot({ path: 'test-results/forty.png', fullPage: true });
  // Reloading the browser source must retain the authoritative scene.
  await frame.goto(`${origin}/overlay?preview=1`);
  await frame.waitForFunction(() => window.__stage?.avatars.size === 40);
  const overlay = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  overlay.on('pageerror', error => errors.push(error.message));
  await overlay.goto(`${origin}/overlay`);
  await overlay.waitForFunction(() => window.__stage?.avatars.size === 40);
  const png = await overlay.screenshot({ path: 'test-results/overlay.png', omitBackground: true });
  const alpha = await overlay.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  }, png.toString('base64'));
  assert.equal(alpha, 0, 'Overlay background must be truly transparent');
  await page.locator('.remove-player').first().click();
  await page.waitForFunction(() => document.querySelector('#count').textContent === '39');
  await overlay.waitForFunction(() => window.__stage.avatars.size === 39);
  await page.locator('#size').evaluate(input => { input.value = '96'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#names').uncheck();
  await page.waitForFunction(() => document.querySelector('#save-note').textContent === 'Настройки сохранены');
  await overlay.waitForFunction(() => window.__stage.getState().settings.size === 96 && !window.__stage.getState().settings.names);
  assert.equal((await fetch(`${origin}/api/clear`, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${origin}/.data/twitch.json`)).status, 404);
  const snapshot = await (await fetch(`${origin}/api/state`)).json();
  assert.ok(!JSON.stringify(snapshot).includes('accessToken'));
  await page.click('#clear-all'); await page.locator('#clear-dialog[open]').waitFor(); await page.click('#confirm-clear');
  await page.waitForFunction(() => document.querySelector('#count').textContent === '0');
  await overlay.waitForFunction(() => window.__stage.avatars.size === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow');
  await stopServer(); await launchServer();
  const restored = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(restored.settings.size, 96); assert.equal(restored.settings.names, false); assert.equal(restored.players.length, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(spriteErrors, []);
  console.log('Browser checks passed: Pokémon catalog/search, selection, real animation frames and pause, 40 avatars, walk, dance, source reload, transparency, removal, settings persistence, request origins, mobile layout.');
  console.log('Screenshots: test-results/stage.png, forty.png, overlay.png, mobile.png');
} catch (error) { console.error(output); throw error; }
finally { await browser?.close(); await stopServer(); await rm(dataDir, { recursive: true, force: true }); }
