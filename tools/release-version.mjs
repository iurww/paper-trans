import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function versionFromTag(tag) {
  const number = '(0|[1-9][0-9]*)';
  const match = new RegExp(`^v${number}\\.${number}(?:\\.${number})?$`).exec(tag);
  if (!match) throw new Error('版本标签必须为 vMAJOR.MINOR 或 vMAJOR.MINOR.PATCH，例如 v0.2、v0.2.1');
  return `${match[1]}.${match[2]}.${match[3] ?? '0'}`;
}

export async function synchronizeVersion(tag, root = fileURLToPath(new URL('../', import.meta.url))) {
  const version = versionFromTag(tag);
  const paths = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
  const contents = await Promise.all(paths.map(path => readFile(resolve(root, path), 'utf8')));
  const [pkg, lock, tauri] = contents.slice(0, 3).map(content => JSON.parse(content));
  if (!lock.packages?.['']) throw new Error('package-lock.json 缺少根包信息');
  pkg.version = lock.version = lock.packages[''].version = tauri.version = version;
  const replaceVersion = (content, pattern, name) => {
    if (!pattern.test(content)) throw new Error(`${name} 中找不到 PaperLens 版本`);
    return content.replace(pattern, (_match, prefix) => `${prefix}${version}"`);
  };
  const cargo = replaceVersion(contents[3], /(\[package\][\s\S]*?^version\s*=\s*")[^"]*"/m, paths[3]);
  const cargoLock = replaceVersion(contents[4], /(\[\[package\]\]\nname = "paperlens"\nversion = ")[^"]*"/, paths[4]);
  const updates = [pkg, lock, tauri].map(value => `${JSON.stringify(value, null, 2)}\n`).concat(cargo, cargoLock);
  for (let index = 0; index < paths.length; index++) await writeFile(resolve(root, paths[index]), updates[index]);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = await synchronizeVersion(process.argv[2]);
    console.log(`PaperLens version: ${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
