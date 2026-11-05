import { z } from 'zod';
import type { MarketPlugin } from '@deepseek-ai/dsh-plugin-market-index';

export const text = z.string().trim().min(1);
export const packageName = text.max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, 'npm 包名无效');
export const packagePath = text.refine(value =>
  value.split('/').every(part => /^[a-zA-Z0-9._@+-]+$/.test(part) && part !== '.' && part !== '..'),
'必须是包内的相对路径');
export const localizedText = z.union([
  text, z.record(text).refine(value => typeof value.en === 'string', '多语言文本必须包含 en'),
]);

export function githubRepository(value: string): { url: string; owner: string; repo: string } {
  const url = new URL(value);
  const match = /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
      url.username || url.password || url.search || url.hash || !match) {
    throw new Error('请使用公开 GitHub 仓库地址 https://github.com/作者/仓库');
  }
  return { url: 'https://github.com/' + match[1] + '/' + match[2], owner: match[1]!, repo: match[2]! };
}

export const sourceSchema = text.transform((value, ctx) => {
  if (value.startsWith('https://')) {
    try { return githubRepository(value).url; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GitHub 仓库地址无效' }); return z.NEVER; }
  }
  if (!packageName.safeParse(value).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请填写 npm 包名或公开 GitHub 仓库地址' });
    return z.NEVER;
  }
  return value;
});
export const configSchema = z.object({
  schemaVersion: z.literal(1),
  title: localizedText,
  description: localizedText,
  tags: z.record(localizedText).refine(value => Object.keys(value).length > 0, '至少配置一个标签')
    .refine(value => Object.keys(value).every(id => /^[a-z][a-z0-9-]*$/.test(id) && id !== 'all'), '标签标识使用小写英文、数字和连字符，不能使用 all'),
}).strict();

/** 清单只保存我们的选择，版本和介绍始终由来源生成。 */
export const entrySchema = z.object({
  source: sourceSchema,
  path: packagePath.optional(),
  tags: z.array(text).min(1, '至少选择一个标签').max(3, '每个插件最多三个标签')
    .refine(tags => new Set(tags).size === tags.length, '标签不能重复'),
  recommendation: z.string().trim().default(''),
  origin: z.enum(['official', 'community']).default('community'),
  enabled: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(100),
}).strict().refine(entry => !entry.path || entry.source.startsWith('https://'), {
  message: 'path 只适用于 GitHub 来源', path: ['path'],
});
export type CatalogConfig = z.infer<typeof configSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type ResolvedPlugin = Omit<MarketPlugin, 'metadata'> & {
  keywords: string[];
  license?: string;
};

export function sourceKey(entry: Pick<Entry, 'source' | 'path'>): string {
  const source = entry.source.startsWith('https://') ? entry.source.toLowerCase() : entry.source;
  return source + (entry.path ? '#' + entry.path : '');
}

export function validateEntries(config: CatalogConfig, entries: Entry[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags) if (!Object.hasOwn(config.tags, tag)) throw new Error('未声明的标签: ' + tag);
    const key = sourceKey(entry);
    if (keys.has(key)) throw new Error('来源重复收录: ' + key);
    keys.add(key);
  }
}
