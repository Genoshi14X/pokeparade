import { mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
const folder = resolve('release/PokeParade-Windows');
await rm(folder, { recursive: true, force: true });
await mkdir(folder, { recursive: true });
for (const file of ['dist', 'package.json', 'package-lock.json', 'start-windows.cmd', 'README.md', 'SPRITES.md', 'THIRD_PARTY_NOTICES.md']) {
  await cp(file, `${folder}/${file}`, { recursive: true });
}
await writeFile(`${folder}/start-windows.cmd`, (await readFile('start-windows.cmd', 'utf8')).replace(/\r?\n/g, '\r\n'));
console.log(`Windows folder ready: ${folder}`);
// Runtime dependencies are installed ON WINDOWS so no macOS executables enter the archive.
const archive = resolve('release/PokeParade-Windows.zip');
await rm(archive, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath '${folder.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-q', '-r', archive, 'PokeParade-Windows'], { cwd: resolve('release'), stdio: 'inherit' });
}
console.log(`Archive ready: ${archive}`);
