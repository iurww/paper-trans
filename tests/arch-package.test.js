import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareArchPackage } from '../tools/prepare-arch-package.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paperlens-arch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('../', import.meta.url));
  await cp(join(repo, 'packaging'), join(root, 'packaging'), { recursive: true });
  await mkdir(join(root, 'src-tauri/target/release'), { recursive: true });
  await cp(join(repo, 'src-tauri/icons'), join(root, 'src-tauri/icons'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const elf = Buffer.alloc(64);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  elf.writeUInt16LE(62, 18);
  await writeFile(join(root, 'src-tauri/target/release/paperlens'), elf);
  return { root, elf };
}

test('Arch package payload includes executable, launch entry, icons, package marker and synchronized version', async t => {
  const { root, elf } = await fixture(t);
  const work = await prepareArchPackage(root);
  const payload = join(work, 'payload');
  assert.deepEqual(await readFile(join(payload, 'usr/bin/paperlens')), elf);
  assert.equal((await stat(join(payload, 'usr/bin/paperlens'))).mode & 0o777, 0o755);
  assert.match(await readFile(join(work, 'PKGBUILD'), 'utf8'), /pkgver=1\.2\.3/);
  assert.match(await readFile(join(work, 'PKGBUILD'), 'utf8'), /webkit2gtk-4\.1/);
  assert.match(await readFile(join(payload, 'usr/share/applications/paperlens.desktop'), 'utf8'), /Exec=paperlens/);
  assert.equal(await readFile(join(payload, 'usr/share/paperlens/package-format'), 'utf8'), 'pacman\n');
  for (const size of [32, 128, 256]) assert.ok((await stat(join(payload, `usr/share/icons/hicolor/${size}x${size}/apps/paperlens.png`))).size > 0);
  await assert.rejects(prepareArchPackage(root), /already exists/);
});

test('Arch packaging rejects a macOS binary or wrong ELF architecture', async t => {
  const { root, elf } = await fixture(t);
  const binary = join(root, 'src-tauri/target/release/paperlens');
  await writeFile(binary, 'Mach-O');
  await assert.rejects(prepareArchPackage(root), /Linux ELF/);
  elf.writeUInt16LE(183, 18);
  await writeFile(binary, elf);
  await assert.rejects(prepareArchPackage(root), /Linux ELF/);
});
