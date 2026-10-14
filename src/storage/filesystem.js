const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createFilesystemStorage(fs, paths, root) {
  let pending = Promise.resolve();
  const serial = action => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const join = (...parts) => paths.join(root, ...parts);
  const component = value => {
    const name = String(value || '').normalize('NFC').trim();
    if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name) || encoder.encode(name).length > 180) {
      throw new Error('目录名称无效：不能包含路径分隔符、控制字符，或超过 180 字节');
    }
    return name;
  };
  const readJson = async file => JSON.parse(decoder.decode(await fs.readFile(file)));
  const writeJson = async (file, value) => {
    await fs.writeFile(`${file}.tmp`, encoder.encode(JSON.stringify(value, null, 2)));
    await fs.rename(`${file}.tmp`, file);
  };
  async function folders() {
    await fs.mkdir(root, { recursive: true });
    const result = [];
    for (const entry of await fs.readDir(root)) {
      if (!entry.isDirectory) continue;
      const file = await join(entry.name, '.folder.json');
      if (await fs.exists(file)) result.push({ ...await readJson(file), name: entry.name });
    }
    if (!result.some(folder => folder.id === 'default')) {
      await saveFolder({ id: 'default', name: 'default' });
      result.unshift({ id: 'default', name: 'default' });
    }
    return result;
  }
  async function saveFolder(folder) {
    const name = component(folder.name);
    const dir = await join(name);
    const marker = await join(name, '.folder.json');
    if (await fs.exists(dir)) {
      if (!await fs.exists(marker) || (await readJson(marker)).id !== folder.id) throw new Error('目录名称已存在');
    }
    await fs.mkdir(dir, { recursive: true });
    await writeJson(marker, { id: component(folder.id), name });
  }
  async function locations() {
    const result = [];
    for (const folder of await folders()) {
      for (const entry of await fs.readDir(await join(folder.name))) {
        if (!entry.isDirectory) continue;
        const dir = await join(folder.name, entry.name);
        const file = await paths.join(dir, 'translation.json');
        if (await fs.exists(file)) {
          const record = await readJson(file);
          result.push({ dir, record: { ...record, folderId: folder.id } });
        }
      }
    }
    return result;
  }
  async function hydrate({ dir, record }) {
    const original = new Blob([await fs.readFile(await paths.join(dir, 'original.pdf'))], { type: 'application/pdf' });
    const translated = record.hasTranslatedPdf
      ? new Blob([await fs.readFile(await paths.join(dir, 'translated.pdf'))], { type: 'application/pdf' }) : null;
    const { schemaVersion, hasTranslatedPdf, ...data } = record;
    return { ...data, original, translated };
  }
  async function get(id) {
    const location = (await locations()).find(item => item.record.id === id);
    return location ? hydrate(location) : undefined;
  }
  async function save(record) {
    const folder = (await folders()).find(item => item.id === (record.folderId || 'default'));
    if (!folder) throw new Error('保存目录不存在');
    const id = component(record.id);
    const existing = (await locations()).find(item => item.record.id === id);
    const title = String(record.filename || 'paper').replace(/\.pdf$/i, '').replace(/[/\\\x00-\x1f]/g, '_');
    const shortTitle = Array.from(title).slice(0, 35).join('').replace(/^\.+$/, '_') || 'paper';
    const directoryName = existing ? existing.dir.split(/[\\/]/).pop() : `${shortTitle}--${id}`;
    const dir = await join(folder.name, directoryName);
    if (existing && existing.dir !== dir) await fs.rename(existing.dir, dir);
    await fs.mkdir(dir, { recursive: true });
    const source = await paths.join(dir, 'original.pdf');
    if (!await fs.exists(source)) {
      if (!record.original) throw new Error('论文原件不存在');
      await fs.writeFile(`${source}.tmp`, new Uint8Array(await record.original.arrayBuffer()));
      await fs.rename(`${source}.tmp`, source);
    }
    if (record.translated) {
      const file = await paths.join(dir, 'translated.pdf');
      await fs.writeFile(`${file}.tmp`, new Uint8Array(await record.translated.arrayBuffer()));
      await fs.rename(`${file}.tmp`, file);
    }
    const { original, translated, ...data } = record;
    // Atomic snapshot keeps translation content and resumable state consistent.
    await writeJson(await paths.join(dir, 'translation.json'), {
      ...data, folderId: folder.id, schemaVersion: 1, hasTranslatedPdf: Boolean(translated),
    });
    await writeJson(await paths.join(dir, 'metadata.json'), {
      ...record.metadata, id, filename: record.filename, folderId: folder.id,
      createdAt: record.createdAt, fingerprint: record.fingerprint,
    });
  }
  async function remove(id) {
    const location = (await locations()).find(item => item.record.id === id);
    if (location) await fs.remove(location.dir, { recursive: true });
  }
  return {
    flush: () => serial(async () => {}),
    getDocument: id => serial(() => get(id)),
    listDocuments: () => serial(async () => Promise.all((await locations()).sort((a, b) => b.record.createdAt - a.record.createdAt).map(hydrate))),
    putDocument: record => serial(() => save(record)),
    listFolders: () => serial(folders),
    putFolder: folder => serial(() => saveFolder(folder)),
    updateDocument: (id, transform) => serial(async () => {
      const record = await get(id);
      if (!record) throw new Error('文献记录不存在');
      const updated = transform(record);
      if (updated.id !== id) throw new Error('不能修改论文 ID');
      await save(updated);
      return updated;
    }),
    deleteDocument: id => serial(() => remove(id)),
    replaceDocument: (id, record) => serial(async () => { await save(record); if (id !== record.id) await remove(id); }),
    migrate: legacy => serial(async () => {
      const marker = await join('.indexeddb-migrated.json');
      const origin = globalThis.location?.origin || 'unknown';
      const migrated = await fs.exists(marker) ? await readJson(marker) : [];
      if (migrated.includes(origin)) return;
      const existingFolders = await folders();
      for (const folder of await legacy.listFolders()) {
        if (existingFolders.some(item => item.id === folder.id)) continue;
        let name = folder.name;
        if (existingFolders.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${name}--${folder.id}`;
        await saveFolder({ ...folder, name });
        existingFolders.push({ ...folder, name });
      }
      const ids = new Set((await locations()).map(item => item.record.id));
      for (const record of await legacy.listDocuments()) if (!ids.has(record.id)) await save(record);
      await writeJson(marker, [...migrated, origin]);
    }),
  };
}
