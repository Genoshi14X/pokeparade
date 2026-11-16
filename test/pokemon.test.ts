import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateSkins } from '../src/server/skins.js';
import { clipTiming, frameIndex } from '../src/client/animation.js';
import { Scene } from '../src/server/scene.js';

const catalog = JSON.parse(readFileSync('public/sprites/manifest.json', 'utf8'));
const skins = validateSkins(catalog.skins);
test('all 151 local Pokémon have complete animation metadata, valid transparent PNG atlases and preview files', () => {
  assert.equal(skins.length, 151);
  assert.deepEqual(skins.map(s => s.dexNumber), Array.from({ length: 151 }, (_, i) => i + 1));
  for (const skin of skins) {
    const png = readFileSync(`public${skin.image}`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', skin.id);
    assert.equal(png.readUInt32BE(16), skin.frameWidth! * skin.columns!, skin.id);
    assert.equal(png.readUInt32BE(20), skin.frameHeight! * skin.rows!, skin.id);
    assert.equal(png[25], 6, `${skin.id}: must have RGBA channels`);
    assert.ok(skin.animations!.idle!.length > 1, `${skin.id}: must be animated`);
    assert.equal(skin.animations!.idle!.length, skin.frameDurations!.length);
    assert.ok(existsSync(`public${skin.preview}`));
  }
  assert.ok(existsSync('public/sprites/pokemon/LICENSE-PokeAPI.txt'));
  const provenance = JSON.parse(readFileSync('public/sprites/pokemon/SOURCE.json', 'utf8'));
  assert.equal(provenance.assets.length, 151);
  assert.match(provenance.spritesCommit, /^[a-f0-9]{40}$/);
});
test('GIF timing preserves unequal durations, loop boundaries and repeated frame references', () => {
  const timing = clipTiming([0, 1, 0], 10, [100, 250]);
  assert.deepEqual(timing.ends, [100, 350, 450]);
  assert.equal(frameIndex(0, timing), 0);
  assert.equal(frameIndex(.1, timing), 1);
  assert.equal(frameIndex(.349, timing), 1);
  assert.equal(frameIndex(.35, timing), 2);
  assert.equal(frameIndex(.45, timing), 0);
  assert.equal(frameIndex(.55, timing), 1);
  const fixed = clipTiming([0, 1], 8);
  assert.equal(frameIndex(.125, fixed), 1);
});
test('Pokémon selection works by dex number and slug; admin selection persists without consuming chat cooldown', () => {
  const scene = new Scene({}, {}, skins);
  scene.join('1', 'viewer'); scene.command('1', 'viewer', '!skin 25');
  assert.equal(scene.players.get('1')!.skin, 'pikachu');
  assert.equal(scene.profiles['1'].skin, 'pikachu');
  scene.command('1', 'viewer', '!skin mew'); assert.equal(scene.players.get('1')!.skin, 'pikachu');
  scene.cooldowns.clear(); scene.command('1', 'viewer', '!skin mew'); assert.equal(scene.players.get('1')!.skin, 'mew');
  assert.equal(scene.setSkin('1', 'charizard'), true); assert.equal(scene.players.get('1')!.skin, 'charizard');
  assert.equal(scene.setSkin('missing', 'pikachu'), false); assert.equal(scene.setSkin('1', '152'), false);
  const restored = new Scene({}, scene.profiles, skins); restored.join('1', 'viewer'); assert.equal(restored.players.get('1')!.skin, 'charizard');
  const migrated = new Scene({}, { old: { name: 'viewer', skin: 'mint' } }, skins); migrated.join('old', 'viewer');
  assert.ok(skins.some(s => s.id === migrated.players.get('old')!.skin));
});
test('manifest rejects invalid timelines, missing images, duplicate numbers and external sprite URLs', () => {
  const valid = skins[24];
  assert.throws(() => validateSkins([{ ...valid, frameDurations: [50] }]));
  assert.throws(() => validateSkins([{ ...valid, frameDurations: valid.frameDurations!.map(() => 0) }]));
  assert.throws(() => validateSkins([{ ...valid, preview: 'https://example.com/pikachu.png' }]));
  assert.throws(() => validateSkins([{ ...valid, image: '/sprites/../private.png' }]));
  assert.throws(() => validateSkins([valid, { ...skins[0], dexNumber: valid.dexNumber }]));
});
