import { readmeByName } from '@deepseek-ai/dsh-plugin-detail';
import type { DetailFiles } from '@deepseek-ai/dsh-plugin-detail';
import { configSchema, entrySchema } from '../src/schema.ts';
import type { Entry, ResolvedPlugin } from '../src/schema.ts';

export const config = configSchema.parse({
  schemaVersion: 1, title: { en: 'Nex', zh: 'Nex 精选' }, description: '测试目录',
  tags: { research: { en: 'Research', zh: '科研' }, automation: { en: 'Automation', zh: '自动化' }, productivity: { en: 'Productivity', zh: '办公效率' } },
});
export const manifest = {
  name: '@example/paper', version: '1.2.0', description: '论文阅读',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  engines: { dsh: '>=0.2.1 <0.3.0' },
  author: 'Example <private@example.invalid> (https://example.invalid)',
  license: 'MIT', repository: { url: 'git+https://github.com/example/paper.git' },
  keywords: ['paper'],
};
export function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return entrySchema.parse({ source: '@example/paper', tags: ['research'], ...overrides });
}
export function makePlugin(name = '@example/paper'): ResolvedPlugin {
  return {
    name, title: '上游插件名称', description: '上游说明', keywords: ['paper'],
    versions: [{
      version: '1.2.0', publishTimestamp: 1793836800,
      source: { type: 'npm' }, engines: { dsh: '>=0.2.1 <0.3.0' },
    }],
  };
}
export function memoryFiles(contents: Record<string, string> = {}): DetailFiles {
  const files: DetailFiles = {
    key: 'fixture',
    async read(path, maxBytes) {
      if (!Object.hasOwn(contents, path)) return undefined;
      const bytes = Buffer.from(contents[path]!);
      if (bytes.length > maxBytes) throw new Error('文件过大');
      return bytes;
    },
    readme: (dir, maxBytes, signal) => readmeByName(files.read, dir, maxBytes, signal),
  };
  return files;
}
