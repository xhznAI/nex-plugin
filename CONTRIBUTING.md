# 贡献精选插件

通过「推荐插件」Issue 提供 npm 包名或公开 GitHub 仓库、用途和推荐理由，也可以直接提交 PR 添加 plugins 下的 YAML。

## 清单格式

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| source | 是 | npm 包名或公开 GitHub 仓库 URL |
| category | 是 | catalog.yaml 中的分类 |
| recommendation | 否 | 我们的推荐理由 |
| origin | 否 | community（默认）或 official（Nex 自研） |
| path | 否 | GitHub 仓库内的包目录 |
| priority | 否 | 默认 100；数值越小越靠前 |
| enabled | 否 | 默认 true；false 暂停展示 |

作者、版本、描述、发布时间、README 和兼容范围由上游提供，不能在清单中覆盖。相同来源只能收录一次；不同来源解析成同一个包时会报告冲突。

## 收录标准

插件应解决明确问题，具备可安装的 DSH bundle、清晰的使用说明和可追溯的作者来源。PR 说明实际使用情况及已知限制即可；上游版本和 README 的后续维护由作者负责。

精选表示推荐，不自动表示逐版本兼容验证或安全认证。自动生成器只读取资料，不安装或运行插件。

## 提交

~~~bash
corepack pnpm check
corepack pnpm build
~~~

检查结果及新增来源的 index.json 可以与清单一起提交。合入 main 后，流水线也会重新生成索引。构建过程需要访问 npm registry、包文件 CDN 和 GitHub API；本地的 GitHub API 配额不足时可提供 GITHUB_TOKEN，它只发往 api.github.com。

## 更新与移除

上游发布新版本、更新介绍后，重新运行 build 即可。无需新增版本记录，也无需修改精选清单。

更换推荐来源、调整分类或推荐理由，直接修改对应清单并提交 PR。移除条目时删除文件或设置 enabled: false。

## 自动同步

仓库内 index.json 是生成产物，维护者不手工编辑其中的插件资料。同步失败不会覆盖当前索引；修复网络或来源后重试 Sync index。
