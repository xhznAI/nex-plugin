import { parseArgs } from 'node:util';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index';
import { buildIndex, entryPath, loadCatalog, readEntry, writeIndex } from './catalog.ts';
import { entrySchema, sourceKey, validateEntries } from './schema.ts';
import { readDetails, resolveSource } from './sources.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const help = [
  'Nex 精选插件：维护来源清单，自动读取上游资料。',
  '',
  'corepack pnpm plugin:add <npm包名或GitHub仓库地址> --category <分类> [--origin official] [--path packages/example]',
  'corepack pnpm plugin:inspect plugins/<文件>.yaml',
  'corepack pnpm plugin:readme plugins/<文件>.yaml [--language zh]',
  'corepack pnpm validate',
  'corepack pnpm build',
  '',
  'build 从 npm/GitHub 刷新资料，生成根目录 index.json。',
  '新增来源会写入精选清单，收录范围由 Nex 维护者决定。',
].join('\n');

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: true,
    options: {
      help: { type: 'boolean' }, path: { type: 'string' }, category: { type: 'string' },
      origin: { type: 'string' }, language: { type: 'string' }, reason: { type: 'string' },
    },
  });
  if (values.help || !positionals.length) { process.stdout.write(help + '\n'); return; }
  const [command, input, ...extra] = positionals;
  if (extra.length) throw new Error('多余的位置参数');
  const allowed = command === 'add' ? ['path', 'category', 'origin', 'reason'] : command === 'readme' ? ['language'] : [];
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error('此命令不接受 --' + key);
  if (command === 'add') {
    if (!input) throw new Error('缺少插件来源');
    const { config, entries } = await loadCatalog(root);
    const entry = entrySchema.parse({
      source: input, category: values.category, origin: values.origin ?? 'community',
      ...(values.path ? { path: values.path } : {}), recommendation: values.reason ?? '',
    });
    validateEntries(config, [...entries, entry]);
    const resolved = await resolveSource(entry);
    if (!resolved.plugin.versions.length) throw new Error('来源没有可安装版本');
    const basename = encodeURIComponent(sourceKey(entry));
    if (Buffer.byteLength(basename + '.yaml') > 240) throw new Error('来源路径过长，请手动建立简短文件名的清单');
    const file = join(root, 'plugins', basename + '.yaml');
    const record = {
      source: entry.source, ...(entry.path ? { path: entry.path } : {}), category: entry.category,
      ...(entry.origin !== 'community' ? { origin: entry.origin } : {}),
      ...(entry.recommendation ? { recommendation: entry.recommendation } : {}),
    };
    await writeFile(file, stringify(record), { flag: 'wx' });
    process.stdout.write('已登记来源: ' + relative(root, file) + '\n');
    return;
  }
  if (command === 'inspect' || command === 'readme') {
    if (!input) throw new Error('缺少收录文件');
    const entry = await readEntry(await entryPath(root, input));
    const source = await resolveSource(entry);
    if (command === 'readme') {
      const detail = await readDetails(source, values.language ?? 'zh');
      if (!detail) throw new Error('上游没有提供可读取的详细介绍或 README');
      process.stdout.write(detail.markdown + '\n');
    } else {
      process.stdout.write(JSON.stringify({
        ...source.plugin,
        versions: source.plugin.versions.map(version => ({ ...version, install: marketInstallTarget(source.plugin.name, version) })),
      }, null, 2) + '\n');
    }
    return;
  }
  if (!['validate', 'build'].includes(command ?? '') || input) throw new Error('命令无效，使用 --help 查看用法');
  const { config, entries } = await loadCatalog(root);
  if (command === 'validate') {
    process.stdout.write('清单校验通过: ' + entries.length + ' 个来源。\n');
    return;
  }
  const index = await buildIndex(config, entries, async entry => (await resolveSource(entry)).plugin);
  await writeIndex(root, index);
  process.stdout.write('已生成 index.json，包含 ' + index.plugins.length + ' 个精选插件。\n');
}

await main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
