import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { buildIndex, entryPath, loadCatalog, parseYaml, validationUrl, writeIndex } from '../src/catalog.ts';
import { entrySchema, sourceKey } from '../src/schema.ts';
import { config, makeEntry, makePlugin } from './fixtures.ts';

test('来源清单只需地址和分类，基础资料与版本由解析器提供', async () => {
  const entry = makeEntry({ recommendation: '用于整理文献。' });
  assert.equal('versions' in entry, false);
  const index = await buildIndex(config, [entry], async () => makePlugin());
  assert.equal(index.plugins[0]!.title, '上游插件名称');
  assert.equal(index.plugins[0]!.nex.recommendation, '用于整理文献。');
  const parsed = parseMarketIndex(index, validationUrl);
  assert.equal(marketInstallTarget(parsed.plugins[0]!.name, parsed.plugins[0]!.versions[0]!).spec, '@example/paper@1.2.0');
});

test('上游资料变更直接反映到新索引，无需改清单或批准版本', async () => {
  const entry = makeEntry();
  const first = await buildIndex(config, [entry], async () => makePlugin());
  const original = makePlugin();
  const next = { ...original, title: '上游的新名称',
    versions: [{ ...original.versions[0]!, version: '1.3.0' }] };
  const second = await buildIndex(config, [entry], async () => next);
  assert.notEqual(first.plugins[0]!.title, second.plugins[0]!.title);
  assert.equal(second.plugins[0]!.versions[0]!.version, '1.3.0');
  assert.equal('approvedVersions' in entry, false);
});

test('停用条目不发送上游请求，索引中也不保留它', async () => {
  const index = await buildIndex(config, [makeEntry({ enabled: false })], async () => assert.fail('不应读取'));
  assert.deepEqual(index.plugins, []);
});

test('来源、解析后的包身份和分类的冲突都明确失败', async () => {
  const resolve = async () => makePlugin();
  await assert.rejects(buildIndex(config, [makeEntry(), makeEntry()], resolve), /重复收录/);
  await assert.rejects(buildIndex(config, [makeEntry(), makeEntry({ source: 'https://github.com/example/paper' })], resolve), /同一个包/);
  await assert.rejects(buildIndex(config, [makeEntry({ category: 'missing' })], resolve), /未声明/);
});

test('GitHub 地址归一化，拒绝凭据、片段、目录穿越和旧的维护字段', () => {
  assert.equal(sourceKey(makeEntry({ source: 'https://github.com/Example/paper.git/' })),
    'https://github.com/example/paper');
  for (const source of ['https://user:secret@github.com/example/paper', 'https://github.com/example/paper#main', 'pkg@latest']) {
    assert.throws(() => makeEntry({ source }));
  }
  assert.throws(() => makeEntry({ source: 'https://github.com/example/paper', path: '../secret' }), /相对路径/);
  assert.throws(() => makeEntry({ path: 'packages/paper' }), /GitHub/);
  assert.throws(() => entrySchema.parse({ source: 'paper', category: 'research', versions: [] }), /Unrecognized/);
  assert.throws(() => parseYaml('source: a\nsource: b\n'), /unique/i);
});

test('输入顺序不影响稳定排序，重复构建不产生时间噪声', async () => {
  const a = makeEntry({ source: 'a' }), b = makeEntry({ source: 'b', priority: 1 });
  const resolve = async (entry: typeof a) => makePlugin(entry.source);
  assert.deepEqual(await buildIndex(config, [a, b], resolve), await buildIndex(config, [b, a], resolve));
  assert.equal((await buildIndex(config, [a, b], resolve)).plugins[0]!.name, 'b');
});

test('源读取失败不覆盖已有索引，成功构建可重复写入', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nex-plugin-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'plugins'));
  await writeFile(join(root, 'catalog.yaml'), stringify(config));
  await writeFile(join(root, 'plugins', 'paper.yaml'), stringify(makeEntry()));
  const loaded = await loadCatalog(root);
  const index = await buildIndex(loaded.config, loaded.entries, async () => makePlugin());
  await writeIndex(root, index);
  const previous = await readFile(join(root, 'index.json'), 'utf8');
  await assert.rejects((async () => {
    const failed = await buildIndex(config, loaded.entries, async () => { throw new Error('来源超时'); });
    await writeIndex(root, failed);
  })(), /来源超时/);
  assert.equal(await readFile(join(root, 'index.json'), 'utf8'), previous);
  await writeIndex(root, index);
  assert.equal(await readFile(join(root, 'index.json'), 'utf8'), previous);
});

test('编辑入口和生成目标拒绝越界路径及符号链接', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nex-plugin-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'plugins'));
  await writeFile(join(root, 'outside.yaml'), stringify(makeEntry()));
  await symlink(join(root, 'outside.yaml'), join(root, 'plugins', 'linked.yaml'));
  await assert.rejects(entryPath(root, 'outside.yaml'), /请选择/);
  await assert.rejects(entryPath(root, 'plugins/linked.yaml'), /请选择|普通文件/);
  await symlink(join(root, 'outside.yaml'), join(root, 'index.json'));
  await assert.rejects(writeIndex(root, await buildIndex(config, [], async () => makePlugin())), /普通文件/);
});
