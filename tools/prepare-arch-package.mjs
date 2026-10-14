import { chmod, copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function prepareArchPackage(root = fileURLToPath(new URL('../', import.meta.url))) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Invalid package version');
  const binary = join(root, 'src-tauri/target/release/paperlens');
  const bytes = await readFile(binary);
  // Arch release job builds a native x86_64 executable, never a macOS binary.
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('hex') !== '7f454c46' || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) {
    throw new Error('Arch package requires an x86_64 Linux ELF executable');
  }
  const work = join(root, 'src-tauri/target/release/bundle/arch/work');
  try { await access(work); throw new Error('Arch packaging directory already exists; use a clean build directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const payload = join(work, 'payload');
  for (const directory of ['usr/bin', 'usr/share/applications', 'usr/share/paperlens', ...[32, 128, 256].map(size => `usr/share/icons/hicolor/${size}x${size}/apps`)]) {
    await mkdir(join(payload, directory), { recursive: true });
  }
  await copyFile(binary, join(payload, 'usr/bin/paperlens'));
  await chmod(join(payload, 'usr/bin/paperlens'), 0o755);
  await copyFile(join(root, 'packaging/arch/paperlens.desktop'), join(payload, 'usr/share/applications/paperlens.desktop'));
  for (const [size, name] of [[32, '32x32.png'], [128, '128x128.png'], [256, '128x128@2x.png']]) {
    await copyFile(join(root, 'src-tauri/icons', name), join(payload, `usr/share/icons/hicolor/${size}x${size}/apps/paperlens.png`));
  }
  await writeFile(join(payload, 'usr/share/paperlens/package-format'), 'pacman\n');
  const template = await readFile(join(root, 'packaging/arch/PKGBUILD.in'), 'utf8');
  if (!template.includes('@VERSION@')) throw new Error('Missing version placeholder');
  await writeFile(join(work, 'PKGBUILD'), template.replaceAll('@VERSION@', version));
  return work;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await prepareArchPackage());
}
