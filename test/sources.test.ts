import { test } from 'node:test';
import assert from 'node:assert/strict';
import semver from 'semver';
import { dshRange, fetchJson, githubFiles, readDetails, resolveSource } from '../src/sources.ts';
import type { Fetcher } from '../src/sources.ts';
import { makeEntry, makePlugin, manifest, memoryFiles } from './fixtures.ts';

const reply = (body: unknown): Response => Response.json(body);
const file = (body: string) => reply({ type: 'file', encoding: 'base64', size: Buffer.byteLength(body),
  content: Buffer.from(body).toString('base64') });
const packument = (versions: Record<string, unknown>) => ({
  name: manifest.name, versions, time: Object.fromEntries(Object.keys(versions).map(version => [version, '2026-11-05T00:00:00Z'])),
});

test('npm 自动列出有效版本，排除弃用、私有、普通包和无效兼容范围', async () => {
  const doc = packument({
    '1.2.0': manifest,
    '1.3.0': { ...manifest, version: '1.3.0', description: '新版说明' },
    '2.0.0': { ...manifest, version: '2.0.0', deprecated: '已弃用' },
    '3.0.0': { ...manifest, version: '3.0.0', private: true },
    '4.0.0': { ...manifest, version: '4.0.0', dsh: {} },
    '5.0.0': { ...manifest, version: '5.0.0', engines: { dsh: 'wrong' } },
  });
  const source = await resolveSource(makeEntry(), {
    fetcher: async url => { assert.equal(String(url), 'https://registry.npmjs.org/%40example%2Fpaper'); return reply(doc); },
    npmFiles: (_name, version) => { assert.equal(version, '1.3.0'); return memoryFiles(); },
  });
  assert.deepEqual(source.plugin.versions.map(version => version.version), ['1.3.0', '1.2.0']);
  assert.deepEqual(source.plugin.description, { en: '新版说明' });
  assert.equal(source.plugin.author, 'Example');
});

test('名称、简介和图标读取上游 locale 与 manifest，不解析 README 里的版本数字', async () => {
  const source = await resolveSource(makeEntry(), {
    fetcher: async () => reply(packument({ '1.2.0': { ...manifest, icon: './icon.svg',
      exports: { './locale/en.json': './i18n/en.json' } } })),
    npmFiles: () => memoryFiles({
      'i18n/en.json': JSON.stringify({ meta: { title: 'Paper', description: 'Read papers' } }),
      'locale/zh.json': JSON.stringify({ meta: { title: '论文助手', description: '阅读文献' } }),
      'README.md': '# Paper\nVersion 999.0.0',
    }),
  });
  assert.deepEqual(source.plugin.title, { en: 'Paper', zh: '论文助手' });
  assert.deepEqual(source.plugin.description, { en: 'Read papers', zh: '阅读文献' });
  assert.match(source.plugin.icon!, /@1\.2\.0\/icon.svg$/);
  assert.equal(source.plugin.versions[0]!.version, '1.2.0');
});

test('缺少插件图标时使用公开仓库头像，但不把仓库所有者冒充为作者', async () => {
  const source = await resolveSource(makeEntry(), {
    fetcher: async url => String(url).startsWith('https://registry.npmjs.org/')
      ? reply(packument({ '1.2.0': { ...manifest, author: undefined } }))
      : reply({ private: false, owner: { login: 'maintainer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' } }),
    npmFiles: () => memoryFiles(),
  });
  assert.equal(source.plugin.icon, 'https://avatars.githubusercontent.com/u/1?v=4');
  assert.equal(source.plugin.author, undefined);
});

test('GitHub 自动跟随 HEAD，同时在生成版本中固定完整提交和包子目录', async () => {
  const sha = 'a'.repeat(40);
  const requests: string[] = [];
  const fetcher: Fetcher = async url => {
    requests.push(String(url));
    if (String(url).endsWith('/repos/example/paper')) return reply({ private: false });
    if (String(url).includes('/commits/HEAD')) return reply({ sha, commit: { committer: { date: '2026-11-04T01:02:03Z' } } });
    if (String(url).includes('/package.json?')) return file(JSON.stringify(manifest));
    return new Response('', { status: 404 });
  };
  const source = await resolveSource(makeEntry({ source: 'https://github.com/example/paper', path: 'packages/paper' }), { fetcher });
  assert.deepEqual(source.plugin.versions[0]!.source, {
    type: 'git', url: 'https://github.com/example/paper', commit: sha, path: 'packages/paper',
  });
  assert.ok(requests.some(url => url.includes('/contents/packages/paper/package.json?ref=' + sha)));
});

test('详情优先采用上游中文 meta.detail，并去除 front matter', async () => {
  const source = { plugin: makePlugin(), files: memoryFiles({
    'locale/zh.json': JSON.stringify({ meta: { detail: 'docs/使用说明.md' } }),
    'docs/使用说明.md': '---\ntitle: 示例\n---\n# 中文说明\n操作方法',
    'README.md': '# English',
  }) };
  assert.deepEqual(await readDetails(source), {
    origin: 'locale', path: 'docs/使用说明.md', markdown: '# 中文说明\n操作方法',
  });
});

test('没有语言详情时直接读取 README；没有任何文档时保持未知', async () => {
  assert.equal((await readDetails({ plugin: makePlugin(), files: memoryFiles({ 'README.md': '# Upstream' }) }))?.markdown, '# Upstream');
  assert.equal(await readDetails({ plugin: makePlugin(), files: memoryFiles() }), undefined);
});

test('包内无 README 时回到原仓库读取，元数据不需要手工补写', async () => {
  const plugin = { ...makePlugin(), repository: { url: 'https://github.com/example/paper' } };
  const fetcher: Fetcher = async url => {
    if (String(url).endsWith('/repos/example/paper')) return reply({ private: false });
    if (String(url).includes('/commits/HEAD')) return reply({ sha: 'b'.repeat(40), commit: { committer: { date: '2026-11-05T00:00:00Z' } } });
    if (String(url).includes('/contents/?')) return reply([{ type: 'file', name: 'README.md' }]);
    if (String(url).includes('/contents/README.md?')) return file('# Repository instructions');
    throw new Error('意外请求');
  };
  const document = await readDetails({ plugin, files: memoryFiles() }, 'zh', { fetcher });
  assert.equal(document?.markdown, '# Repository instructions');
});

test('错误详情声明不回退，Git 文件拒绝越界路径和浮动引用', async () => {
  await assert.rejects(readDetails({ plugin: makePlugin(), files: memoryFiles({
    'locale/zh.json': JSON.stringify({ meta: { detail: '../secret.md' } }), 'README.md': 'fallback',
  }) }), /relative path/);
  assert.throws(() => githubFiles('https://github.com/example/paper', 'main'), /完整提交/);
  const files = githubFiles('https://github.com/example/paper', 'c'.repeat(40), '', async () => assert.fail('不应请求'));
  await assert.rejects(files.read('../secret', 1000, new AbortController().signal), /路径无效/);
});

test('读取错误和没有可安装版本时失败，不伪造空结果', async () => {
  await assert.rejects(fetchJson('https://example.invalid', async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(resolveSource(makeEntry(), { fetcher: async () => reply(packument({})) }), /没有有效/);
  await assert.rejects(resolveSource(makeEntry(), { fetcher: async () => reply({ name: 'other' }) }), /不同的包名/);
});

test('即使 API 令牌能够读取私有仓库，也不能把它收录为公开来源', async () => {
  let requests = 0;
  await assert.rejects(resolveSource(makeEntry({ source: 'https://github.com/example/private' }), {
    fetcher: async () => { requests++; return reply({ private: true }); },
  }), /公开 GitHub/);
  assert.equal(requests, 1);
});

test('DSH peer 的或范围正确求交，并遵循上游对 workspace 范围的约定', () => {
  const range = dshRange({ peerDependencies: {
    '@deepseek-ai/dsh-tools': '^0.2.0 || ^0.3.0',
    '@deepseek-ai/dsh-settings': '>=0.2.5 <0.3.5',
  } })!;
  assert.equal(semver.satisfies('0.2.4', range), false);
  assert.equal(semver.satisfies('0.2.6', range), true);
  assert.equal(semver.satisfies('0.3.4', range), true);
  assert.equal(semver.satisfies('0.3.5', range), false);
  assert.equal(dshRange({ peerDependencies: { '@deepseek-ai/dsh-tools': 'workspace:*' } }), undefined);
  assert.throws(() => dshRange({ peerDependencies: {
    '@deepseek-ai/dsh-tools': '<0.2.0', '@deepseek-ai/dsh-settings': '>=0.3.0',
  } }), /没有满足/);
});
