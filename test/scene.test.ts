import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../src/server/scene.js';
import { DEFAULT_SETTINGS, DEFAULT_SKINS } from '../src/shared.js';

const create = () => new Scene({}, {}, DEFAULT_SKINS, () => .6);
test('40 unique participants, FIFO queue and immediate admission when somebody leaves', () => {
  const scene = create();
  for (let i = 0; i < 43; i++) scene.command(String(i), `user${i}`, '!join');
  assert.equal(scene.players.size, 40); assert.deepEqual([...scene.queue.keys()], ['40', '41', '42']);
  scene.command('0', 'user0', '!join'); assert.equal(scene.players.size, 40);
  scene.command('0', 'user0', '!leave'); assert.ok(scene.players.has('40')); assert.equal(scene.players.size, 40);
  scene.command('42', 'user42', '!leave'); assert.deepEqual([...scene.queue.keys()], ['41']);
});
test('commands apply only to participants, cooldown prevents repeated actions and saved skin survives a new scene', () => {
  const scene = create();
  scene.command('1', 'viewer', '!jump'); assert.equal(scene.players.size, 0);
  scene.command('1', 'viewer', '!join'); scene.command('1', 'viewer', '!skin 3');
  assert.equal(scene.players.get('1')!.skin, 'lilac');
  scene.command('1', 'viewer', '!dance'); assert.equal(scene.players.get('1')!.action, 'idle');
  scene.cooldowns.clear(); scene.command('1', 'viewer', '!jump'); assert.equal(scene.players.get('1')!.action, 'jump');
  scene.tick(1); assert.equal(scene.players.get('1')!.action, 'walk');
  scene.command('1', 'viewer', '!leave'); assert.equal(scene.players.size, 0);
  const restored = new Scene({}, scene.profiles); restored.join('1', 'renamed'); assert.equal(restored.players.get('1')!.skin, 'lilac');
});
test('walk bounces inside boundaries, pause freezes animation clock and resuming continues', () => {
  const scene = create(); scene.join('1', 'viewer'); const p = scene.players.get('1')!;
  p.x = 1880; p.direction = 1; p.action = 'walk'; p.until = 100;
  scene.tick(.1); assert.ok(p.x <= 1920 - scene.settings.size / 2 - 12); assert.equal(p.direction, -1);
  const x = p.x, time = scene.time; scene.paused = true; scene.tick(5); assert.equal(p.x, x); assert.equal(scene.time, time);
  scene.paused = false; scene.tick(.1); assert.ok(p.x < x);
});
test('idle timeout admits queued viewer, ignores demo and can be disabled', () => {
  const scene = create(); scene.updateSettings({ idleMinutes: 15 }); scene.demo(39); scene.join('real', 'viewer'); scene.join('queued', 'next');
  scene.players.get('real')!.lastActive = Date.now() - 16 * 60_000;
  scene.tick(.1); assert.ok(!scene.players.has('real')); assert.ok(scene.players.has('queued')); assert.equal(scene.players.size, 40);
  scene.settings.idleMinutes = 0; scene.players.get('queued')!.lastActive = 0; scene.tick(.1); assert.ok(scene.players.has('queued'));
});
test('auto join, demo clearing, queue clearing and settings validation', () => {
  const scene = create(); scene.command('1', 'viewer', 'hello'); assert.equal(scene.players.size, 0);
  scene.updateSettings({ autoJoin: true, size: 999, bottom: -1, speed: Number.NaN, fps: 120 });
  assert.equal(scene.settings.size, 120); assert.equal(scene.settings.bottom, 0); assert.equal(scene.settings.speed, DEFAULT_SETTINGS.speed); assert.equal(scene.settings.fps, 30);
  scene.command('1', 'viewer', 'hello'); scene.demo(40); scene.join('2', 'queued');
  scene.clear(true); assert.ok(scene.players.has('1')); assert.ok(scene.players.has('2')); assert.equal(scene.players.size, 2);
  scene.demo(40); scene.join('3', 'another'); scene.clear(); assert.equal(scene.players.size, 0); assert.equal(scene.queue.size, 0);
});
test('queue is bounded and invalid skin selection does not overwrite the profile', () => {
  const scene = create(); scene.demo(40);
  for (let i = 0; i < 500; i++) scene.join(String(i), 'viewer');
  assert.equal(scene.queue.size, 200);
  scene.clear(); scene.join('1', 'viewer'); const skin = scene.players.get('1')!.skin;
  scene.command('1', 'viewer', '!skin -1'); assert.equal(scene.players.get('1')!.skin, skin);
});
