import { readFile, readdir, mkdir, writeFile, rename, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { configSchema, entrySchema, sourceKey, validateEntries } from './schema.ts';
import type { CatalogConfig, Entry, ResolvedPlugin } from './schema.ts';

export const validationUrl = 'https://nex-plugin.invalid/index.json';

export function parseYaml(content: string): unknown {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map(error => error.message).join('\n'));
  return document.toJS({ maxAliasCount: 0 });
}

export async function readEntry(file: string): Promise<Entry> {
  return entrySchema.parse(parseYaml(await readFile(file, 'utf8')));
}

export async function loadCatalog(root: string): Promise<{ config: CatalogConfig; entries: Entry[] }> {
  const config = configSchema.parse(parseYaml(await readFile(join(root, 'catalog.yaml'), 'utf8')));
  const entries: Entry[] = [];
  const directory = await lstat(join(root, 'plugins'));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('plugins 必须是本仓库中的普通目录');
  const files = await readdir(join(root, 'plugins'), { withFileTypes: true });
  for (const file of files.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!/\.ya?ml$/.test(file.name)) continue;
    if (!file.isFile()) throw new Error('收录文件必须是普通文件: ' + file.name);
    try { entries.push(await readEntry(join(root, 'plugins', file.name))); }
    catch (error) { throw new Error(file.name + ': ' + (error instanceof Error ? error.message : String(error))); }
  }
  validateEntries(config, entries);
  return { config, entries };
}

/** 任何来源读取失败都先中止，不覆盖已有索引；停用的来源不发送请求。 */
export async function buildIndex(
  config: CatalogConfig, entries: Entry[], resolvePlugin: (entry: Entry) => Promise<ResolvedPlugin>,
) {
  validateEntries(config, entries);
  const names = new Set<string>();
  const plugins = [];
  const selected = entries.filter(entry => entry.enabled).sort((left, right) =>
    left.priority - right.priority || sourceKey(left).localeCompare(sourceKey(right), 'en'));
  for (const entry of selected) {
    const upstream = await resolvePlugin(entry);
    if (names.has(upstream.name)) throw new Error('多个精选来源指向同一个包: ' + upstream.name);
    names.add(upstream.name);
    const { keywords, license, ...plugin } = upstream;
    plugins.push({
      ...plugin,
      metadata: { category: entry.category, labels: [entry.origin], keywords },
      nex: {
        source: entry.source, ...(entry.path ? { path: entry.path } : {}),
        origin: entry.origin, recommendation: entry.recommendation,
        ...(license ? { license } : {}),
      },
    });
  }
  const index = {
    format: 1 as const,
    title: config.title,
    description: config.description,
    metadata: {
      categories: Object.fromEntries(Object.entries(config.categories).map(([id, title]) => [id, { title }])),
      labels: {
        official: { title: { en: 'By Nex', zh: '官方开发' } },
        community: { title: { en: 'Community Pick', zh: '社区推荐' } },
      },
    },
    plugins,
    nex: { schemaVersion: 1 },
  };
  parseMarketIndex(index, validationUrl);
  return index;
}

export async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = join(dirname(file), '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function writeIndex(root: string, index: Awaited<ReturnType<typeof buildIndex>>): Promise<void> {
  const file = join(root, 'index.json');
  const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('index.json 必须是本仓库中的普通文件');
  await atomicWrite(file, JSON.stringify(index, null, 2) + '\n');
}

export async function entryPath(root: string, input: string): Promise<string> {
  const directory = await lstat(join(root, 'plugins'));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('plugins 必须是本仓库中的普通目录');
  const folder = await realpath(join(root, 'plugins'));
  const file = await realpath(resolve(root, input));
  const path = relative(folder, file);
  if (path.startsWith('..') || path.includes('/') || path.includes('\\') || !/\.ya?ml$/.test(path)) {
    throw new Error('请选择本仓库 plugins 目录中的 YAML 收录文件');
  }
  if (!(await lstat(resolve(root, input))).isFile()) throw new Error('收录文件必须是普通文件');
  return file;
}
