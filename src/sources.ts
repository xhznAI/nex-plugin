import semver from 'semver';
import { exports as resolveExports } from 'resolve.exports';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import type { MarketVersion } from '@deepseek-ai/dsh-plugin-market-index';
import { languageChain, npmFiles, readmeName, readPackageDocument, markdownOf } from '@deepseek-ai/dsh-plugin-detail';
import type { DetailFiles, PackageDocument } from '@deepseek-ai/dsh-plugin-detail';
import { githubRepository, packageName } from './schema.ts';
import type { Entry, ResolvedPlugin } from './schema.ts';

export type Fetcher = typeof fetch;
type ObjectValue = Record<string, unknown>;
export type SourceOptions = {
  fetcher?: Fetcher;
  npmFiles?: (name: string, version: string) => DetailFiles;
};
export type ResolvedSource = { plugin: ResolvedPlugin; files: DetailFiles };
const validationUrl = 'https://nex-plugin.invalid/index.json';
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export async function fetchJson(url: string, fetcher: Fetcher = fetch, missing = false): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'nex-plugin-catalog' };
  // GitHub 的只读请求可用流水线内置令牌；令牌不会发往 npm 或文件 CDN。
  if (new URL(url).origin === 'https://api.github.com' && process.env.GITHUB_TOKEN) {
    headers.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers });
  if (missing && response.status === 404) return undefined;
  if (!response.ok || !response.body) throw new Error('来源读取失败 (' + response.status + '): ' + url);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16 * 1024 * 1024) throw new Error('来源元数据超过 16 MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

function filePath(value: string): string {
  const path = value.replace(/^\.\//, '');
  if (!path || path.includes('\\') || path.includes('\0') || path.includes(':') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('包内文件路径无效');
  return path;
}

export function githubFiles(repository: string, commit: string, path = '', fetcher: Fetcher = fetch): DetailFiles {
  const { owner, repo } = githubRepository(repository);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Git 文件必须固定到完整提交');
  const cache = new Map<string, Promise<unknown>>();
  const read = (name: string) => {
    const full = [path, name].filter(Boolean).join('/');
    if (full) filePath(full);
    let pending = cache.get(full);
    if (!pending) {
      pending = fetchJson('https://api.github.com/repos/' + owner + '/' + repo + '/contents/' +
        full.split('/').map(encodeURIComponent).join('/') + '?ref=' + commit, fetcher, true);
      cache.set(full, pending);
    }
    return pending;
  };
  const files: DetailFiles = {
    key: repository + '#' + commit + '/' + path,
    async read(name, maxBytes, signal) {
      signal.throwIfAborted();
      const response = await read(filePath(name));
      if (response === undefined) return undefined;
      const file = object(response);
      if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' ||
          typeof file.size !== 'number' || file.size > maxBytes) throw new Error('GitHub 文件无效或过大: ' + name);
      const bytes = Buffer.from(file.content, 'base64');
      if (bytes.length !== file.size) throw new Error('GitHub 文件大小不符: ' + name);
      return bytes;
    },
    async readme(dir, maxBytes, signal) {
      const response = await read(dir);
      if (response === undefined) return undefined;
      if (!Array.isArray(response)) throw new Error('GitHub 未返回目录列表');
      const name = readmeName(response.filter(row => object(row).type === 'file')
        .map(row => String(object(row).name)));
      if (!name) return undefined;
      const relative = dir ? dir + '/' + name : name;
      const bytes = await files.read(relative, maxBytes, signal);
      return bytes === undefined ? undefined : { path: relative, bytes };
    },
  };
  return files;
}

function isBundle(manifest: ObjectValue): boolean {
  const patch = object(object(manifest.dsh).bundle).patch;
  const patches = Array.isArray(patch) ? patch : [patch];
  return !manifest.deprecated && patches.length > 0 &&
    patches.every(value => { try { return typeof value === 'string' && !!filePath(value); } catch { return false; } });
}

/** 与 DSH 索引生成器保持一致：显式范围优先，否则对全部 DSH peer 范围求交。 */
export function dshRange(manifest: ObjectValue): string | undefined {
  const explicit = object(manifest.engines).dsh;
  const valid = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || !semver.validRange(value.trim())) throw new Error('DSH 兼容范围无效');
    return value.trim();
  };
  if (explicit !== undefined) return valid(explicit);
  const ranges = [...new Set(Object.entries(object(manifest.peerDependencies))
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
    .map(([, range]) => range).filter(range => !['workspace:*', 'workspace:^', 'workspace:~'].includes(String(range)))
    .map(valid).filter(range => range !== '*'))];
  if (!ranges.length) return undefined;
  let groups: string[][] = [[]];
  for (const range of ranges) {
    groups = groups.flatMap(group => new semver.Range(range).set.map(terms =>
      [...group, ...terms.map(term => term.value).filter(Boolean)]));
    if (groups.length > 256) throw new Error('DSH 兼容范围组合过多');
  }
  const written = [...new Set(groups.map(terms => terms.join(' ') || '*'))];
  if (!written.some(range => semver.minVersion(range))) throw new Error('没有满足全部 DSH peer 的版本');
  return ranges.length === 1 ? ranges[0] : written.join(' || ');
}

function versionOf(manifest: ObjectValue, source: MarketVersion['source'], published: unknown): MarketVersion {
  // GitHub 仓库的公开性由 API 校验；manifest 的 private 只限制 npm 发布。
  if ((source.type === 'npm' && manifest.private === true) || !isBundle(manifest)) {
    throw new Error('来源不是可安装的公开 DSH bundle');
  }
  const range = dshRange(manifest);
  const parsed = parseMarketIndex({
    format: 1, title: 'Source', plugins: [{
      name: packageName.parse(manifest.name), versions: [{
        version: manifest.version, publishTimestamp: Math.floor(Date.parse(String(published)) / 1000),
        source, ...(range ? { engines: { dsh: range } } : {}),
      }],
    }],
  }, validationUrl);
  return parsed.plugins[0]!.versions[0]!;
}

function repositoryOf(value: unknown): ResolvedPlugin['repository'] {
  const record = object(value);
  let url = text(typeof value === 'string' ? value : record.url);
  if (!url) return undefined;
  url = url.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/')
    .replace(/^git:\/\/github\.com\//, 'https://github.com/').replace(/^git@github\.com:/, 'https://github.com/');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
    parsed.hash = ''; parsed.search = ''; parsed.pathname = parsed.pathname.replace(/\.git$/, '');
    const directory = text(record.directory);
    return { url: parsed.href, ...(directory ? { directory: filePath(directory) } : {}) };
  } catch { return undefined; }
}

function exportedPath(manifest: ObjectValue, subpath: string): string | undefined {
  try {
    const paths = resolveExports(manifest as Parameters<typeof resolveExports>[0], subpath, { conditions: ['import', 'node', 'default'] });
    return paths?.[0] ? filePath(paths[0]) : undefined;
  } catch { return undefined; }
}

async function metadata(manifest: ObjectValue, files: DetailFiles, versions: MarketVersion[], fetcher: Fetcher = fetch): Promise<ResolvedPlugin> {
  const titles: Record<string, string> = { en: String(manifest.name) };
  const descriptions: Record<string, string> = { ...(text(manifest.description) ? { en: text(manifest.description)! } : {}) };
  for (const language of ['en', 'zh']) {
    const path = exportedPath(manifest, './locale/' + language + '.json') ?? 'locale/' + language + '.json';
    const bytes = await files.read(path, 1024 * 1024, AbortSignal.timeout(20_000));
    if (!bytes) continue;
    const meta = object(object(JSON.parse(new TextDecoder().decode(bytes))).meta);
    if (text(meta.title)) titles[language] = text(meta.title)!;
    if (text(meta.description)) descriptions[language] = text(meta.description)!;
  }
  const author = text(typeof manifest.author === 'string'
    ? manifest.author.replace(/<[^>]*>|\([^)]*\)/g, '').trim() : object(manifest.author).name);
  const repo = repositoryOf(manifest.repository);
  let homepage: string | undefined;
  try {
    const url = new URL(String(manifest.homepage));
    if (url.protocol === 'https:' && !url.username && !url.password) homepage = url.href;
  } catch { /* 上游没有主页时省略。 */ }
  let icon: string | undefined;
  const iconPath = text(manifest.icon) ?? exportedPath(manifest, './icon');
  if (iconPath && versions[0]) {
    const path = filePath(iconPath);
    const source = versions[0].source;
    if (source.type === 'npm') icon = 'https://cdn.jsdelivr.net/npm/' + manifest.name + '@' + versions[0].version + '/' + path;
    else {
      const { owner, repo: name } = githubRepository(source.url);
      icon = 'https://raw.githubusercontent.com/' + owner + '/' + name + '/' + source.commit + '/' +
        (source.path ? source.path + '/' : '') + path;
    }
  }
  if (!icon && repo?.url.startsWith('https://github.com/')) {
    try {
      const { owner, repo: name } = githubRepository(repo.url);
      const info = object(await fetchJson('https://api.github.com/repos/' + owner + '/' + name, fetcher));
      const avatar = new URL(String(object(info.owner).avatar_url));
      if (info.private === false && avatar.origin === 'https://avatars.githubusercontent.com' && !avatar.username && !avatar.password) icon = avatar.href;
    } catch { /* 头像缺失不影响收录，客户端仍可显示默认图标。 */ }
  }
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((value): value is string => typeof value === 'string') : [];
  const raw = {
    name: manifest.name, title: titles,
    ...(descriptions.en ? { description: descriptions } : text(manifest.description) ? { description: manifest.description } : {}),
    ...(author && !/^\S+@\S+\.\S+$/.test(author) ? { author } : {}),
    ...(repo ? { repository: repo } : {}), ...(homepage ? { homepage } : {}), ...(icon ? { icon } : {}),
    versions,
  };
  const { metadata: _metadata, ...plugin } = parseMarketIndex({ format: 1, title: 'Source', plugins: [raw] }, validationUrl).plugins[0]!;
  return { ...plugin, keywords, ...(text(manifest.license) ? { license: text(manifest.license) } : {}) };
}

async function resolveNpm(entry: Entry, options: SourceOptions): Promise<ResolvedSource> {
  const packument = object(await fetchJson('https://registry.npmjs.org/' + encodeURIComponent(entry.source), options.fetcher));
  if (packument.name !== entry.source) throw new Error('npm 返回了不同的包名');
  const manifests = object(packument.versions);
  const versions: MarketVersion[] = [];
  for (const [version, data] of Object.entries(manifests)) {
    const manifest = object(data);
    if (manifest.name !== entry.source || manifest.version !== version) continue;
    try { versions.push(versionOf(manifest, { type: 'npm' }, object(packument.time)[version])); }
    catch { /* 普通包版本、弃用版本和无效版本不进入可安装索引。 */ }
  }
  versions.sort((left, right) => semver.rcompare(left.version, right.version));
  if (!versions.length) throw new Error('npm 来源没有有效的 DSH bundle 版本: ' + entry.source);
  const top = versions[0]!;
  const files = options.npmFiles?.(entry.source, top.version) ??
    npmFiles(entry.source, top.version, ['npmmirror', 'jsdelivr', 'unpkg'], {
      timeoutMs: 8_000, lifetime: new AbortController().signal,
    });
  return { plugin: await metadata(object(manifests[top.version]), files, versions, options.fetcher), files };
}

async function githubHead(url: string, fetcher: Fetcher = fetch): Promise<{ sha: string; date: string }> {
  const { owner, repo } = githubRepository(url);
  const repository = object(await fetchJson('https://api.github.com/repos/' + owner + '/' + repo, fetcher));
  if (repository.private !== false) throw new Error('精选来源必须是公开 GitHub 仓库');
  const commit = object(await fetchJson('https://api.github.com/repos/' + owner + '/' + repo + '/commits/HEAD', fetcher));
  const date = text(object(object(commit.commit).committer).date);
  if (typeof commit.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha) || !date) throw new Error('GitHub 未返回有效提交和时间');
  return { sha: commit.sha, date };
}

export async function resolveSource(entry: Entry, options: SourceOptions = {}): Promise<ResolvedSource> {
  if (!entry.source.startsWith('https://')) return resolveNpm(entry, options);
  const { sha, date } = await githubHead(entry.source, options.fetcher);
  const files = githubFiles(entry.source, sha, entry.path, options.fetcher);
  const bytes = await files.read('package.json', 1024 * 1024, AbortSignal.timeout(20_000));
  if (!bytes) throw new Error('GitHub 来源没有 package.json');
  const manifest = object(JSON.parse(new TextDecoder().decode(bytes)));
  const version = versionOf(manifest, {
    type: 'git', url: entry.source, commit: sha, ...(entry.path ? { path: entry.path } : {}),
  }, date);
  return { plugin: await metadata(manifest, files, [version], options.fetcher), files };
}

/** 详情复用 DSH 的文档顺序；README 内容不写入精选清单或索引。 */
export async function readDetails(source: ResolvedSource, language = 'zh', options: SourceOptions = {}): Promise<PackageDocument | undefined> {
  const signal = AbortSignal.timeout(60_000);
  const document = await readPackageDocument(source.files, '', languageChain(language), 1024 * 1024, signal);
  if (document) return document;
  const repository = source.plugin.repository;
  if (!repository || new URL(repository.url).hostname !== 'github.com') return undefined;
  const { sha } = await githubHead(repository.url, options.fetcher);
  const files = githubFiles(repository.url, sha, repository.directory, options.fetcher);
  const readme = await files.readme('', 1024 * 1024, signal);
  return readme ? { origin: 'readme', path: readme.path, markdown: markdownOf(readme.bytes) } : undefined;
}
