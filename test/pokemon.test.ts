import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateSkins } from '../src/server/skins.js';
import { clipTiming, frameIndex } from '../src/client/animation.js';
import { Scene } from '../src/server/scene.js';

const catalog = JSON.parse(readFileSync('public/sprites/manifest.json', 'utf8'));
const skins = validateSkins(catalog.skins);
test('all 493 Pokémon from generations I–IV and their shiny variants have valid local atlases and previews', () => {
  assert.equal(skins.length, 986);
  const regular = skins.filter(s => !s.shiny), shiny = skins.filter(s => s.shiny);
  assert.equal(shiny.length, 493);
  assert.deepEqual(regular.map(s => s.dexNumber), Array.from({ length: 493 }, (_, i) => i + 1));
  assert.deepEqual([1, 2, 3, 4].map(g => regular.filter(s => s.generation === g).length), [151, 100, 135, 107]);
  assert.deepEqual(shiny.map(s => s.dexNumber), regular.map(s => s.dexNumber));
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
  assert.equal(provenance.assets.length, 986);
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
  const scene = new Scene({ shinyOdds: 0 }, {}, skins);
  scene.join('1', 'viewer'); scene.command('1', 'viewer', '!skin 25');
  assert.equal(scene.players.get('1')!.skin, 'pikachu');
  assert.equal(scene.profiles['1'].skin, 'pikachu');
  scene.command('1', 'viewer', '!skin mew'); assert.equal(scene.players.get('1')!.skin, 'pikachu');
  scene.cooldowns.clear(); scene.command('1', 'viewer', '!skin mew'); assert.equal(scene.players.get('1')!.skin, 'mew');
  assert.equal(scene.setSkin('1', 'charizard'), true); assert.equal(scene.players.get('1')!.skin, 'charizard');
  assert.equal(scene.setSkin('missing', 'pikachu'), false); assert.equal(scene.setSkin('1', '494'), false);
  const restored = new Scene({}, scene.profiles, skins); restored.join('1', 'viewer'); assert.equal(restored.players.get('1')!.skin, 'charizard');
  const migrated = new Scene({}, { old: { name: 'viewer', skin: 'mint' } }, skins); migrated.join('old', 'viewer');
  assert.ok(skins.some(s => s.id === migrated.players.get('old')!.skin));
});
test('numeric chat choice rolls shiny at the exact threshold, only after cooldown and persists the result', () => {
  let roll = 0, calls = 0;
  const scene = new Scene({ shinyOdds: 128 }, {}, skins, () => { calls++; return roll; });
  scene.join('1', 'viewer'); calls = 0;
  scene.command('1', 'viewer', '!skin 25');
  assert.equal(scene.players.get('1')!.skin, 'pikachu-shiny'); assert.equal(calls, 1);
  assert.equal(scene.profiles['1'].skin, 'pikachu-shiny');
  const restored = new Scene({}, scene.profiles, skins); restored.join('1', 'viewer'); assert.equal(restored.players.get('1')!.skin, 'pikachu-shiny');
  scene.command('1', 'viewer', '!skin 493'); assert.equal(calls, 1); assert.equal(scene.players.get('1')!.skin, 'pikachu-shiny');
  scene.cooldowns.clear(); roll = 1 / 128;
  scene.command('1', 'viewer', '!skin 25'); assert.equal(scene.players.get('1')!.skin, 'pikachu'); assert.equal(calls, 2);
  scene.cooldowns.clear(); roll = 1 / 128 - 1e-8;
  scene.command('1', 'viewer', '!skin 493'); assert.equal(scene.players.get('1')!.skin, 'arceus-shiny');
  scene.cooldowns.clear(); const before = calls;
  scene.command('1', 'viewer', '!skin 9999'); assert.equal(calls, before);
});
test('shiny odds can be disabled or guaranteed; names and explicit shiny IDs cannot bypass the chat roll', () => {
  const scene = new Scene({ shinyOdds: 0 }, {}, skins, () => 0);
  scene.join('1', 'viewer'); assert.equal(scene.players.get('1')!.skin, 'bulbasaur');
  scene.command('1', 'viewer', '!skin 25'); assert.equal(scene.players.get('1')!.skin, 'pikachu');
  scene.cooldowns.clear(); scene.updateSettings({ shinyOdds: 1 });
  scene.command('1', 'viewer', '!skin 387'); assert.equal(scene.players.get('1')!.skin, 'turtwig-shiny');
  scene.cooldowns.clear(); scene.command('1', 'viewer', '!skin pikachu'); assert.equal(scene.players.get('1')!.skin, 'pikachu');
  scene.cooldowns.clear(); scene.command('1', 'viewer', '!skin pikachu-shiny'); assert.equal(scene.players.get('1')!.skin, 'pikachu');
  assert.equal(scene.setSkin('1', 'pikachu-shiny'), true); assert.equal(scene.players.get('1')!.skin, 'pikachu-shiny');
  scene.updateSettings({ shinyOdds: -10 }); assert.equal(scene.settings.shinyOdds, 0);
  scene.updateSettings({ shinyOdds: 99999 }); assert.equal(scene.settings.shinyOdds, 8192);
  const oldSettings = new Scene({ size: 96 }, {}, skins); assert.equal(oldSettings.settings.shinyOdds, 128);
});
test('when a species has no shiny asset it stays normal and a missing shiny never consumes a roll', () => {
  let rolls = 0;
  const scene = new Scene({ shinyOdds: 1 }, {}, skins.filter(s => !s.shiny), () => { rolls++; return 0; });
  scene.join('1', 'viewer'); rolls = 0;
  scene.command('1', 'viewer', '!skin 25'); assert.equal(scene.players.get('1')!.skin, 'pikachu'); assert.equal(rolls, 0);
});
test('leaving and rejoining cannot reset the cooldown for a shiny attempt', () => {
  const scene = new Scene({ shinyOdds: 1 }, {}, skins, () => 0);
  scene.command('1', 'viewer', '!join'); scene.command('1', 'viewer', '!skin 25');
  assert.equal(scene.players.get('1')!.skin, 'pikachu-shiny');
  scene.command('1', 'viewer', '!leave'); scene.command('1', 'viewer', '!join');
  scene.command('1', 'viewer', '!skin 493'); assert.equal(scene.players.get('1')!.skin, 'pikachu-shiny');
  scene.cooldowns.set('1', Date.now() - 1); scene.tick(0);
  assert.equal(scene.cooldowns.has('1'), false);
  scene.command('1', 'viewer', '!skin 493'); assert.equal(scene.players.get('1')!.skin, 'arceus-shiny');
});
test('manifest rejects invalid timelines, missing images, duplicate numbers and external sprite URLs', () => {
  const valid = skins[24];
  assert.throws(() => validateSkins([{ ...valid, frameDurations: [50] }]));
  assert.throws(() => validateSkins([{ ...valid, frameDurations: valid.frameDurations!.map(() => 0) }]));
  assert.throws(() => validateSkins([{ ...valid, preview: 'https://example.com/pikachu.png' }]));
  assert.throws(() => validateSkins([{ ...valid, image: '/sprites/../private.png' }]));
  assert.throws(() => validateSkins([valid, { ...skins[0], dexNumber: valid.dexNumber }]));
});
