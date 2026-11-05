# 贡献精选插件

[← 回到首页](README.md) · [维护与接入](docs/maintenance.md)

Nex 维护者决定精选清单的收录范围。官方自研插件和社区插件使用同一套收录流程；维护者可以直接更新清单，社区贡献者可提交 Issue 或 PR。

## 推荐一个插件

填写 [推荐插件表单](https://github.com/xhznAI/nex-plugin/issues/new?template=plugin-request.yml)，提供 npm 包名或公开 GitHub 仓库、用途、推荐理由和实际使用情况。维护者确认收录后加入目录。

## 提交收录 PR

1. Fork 仓库，在 `plugins/` 新增一份 YAML，填写来源、用途标签和推荐理由。
2. 按下方字段说明填写清单，运行检查并生成索引。
3. 提交 [Pull Request](https://github.com/xhznAI/nex-plugin/pulls)，说明适用场景、实际使用情况与已知限制。

最小清单示例：

```yaml
source: "@author/dsh-example"
tags: [research]
recommendation: "适合文献阅读和资料整理。"
```

示例来源需替换为实际插件。GitHub 来源填写仓库 URL，例如 `https://github.com/author/dsh-example`。

## 清单格式

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| source | 是 | npm 包名或公开 GitHub 仓库 URL |
| tags | 是 | catalog.yaml 中一至三个不重复的用途标签；例如 [research] 或 [media, creator] |
| recommendation | 否 | 插件适用场景及推荐理由 |
| origin | 否 | 开发者归属：community（社区开发，默认）或 official（Nex 自研）；两者均由 Nex 精选 |
| path | 否 | GitHub 仓库内的包目录 |
| priority | 否 | 默认 100；数值越小越靠前 |
| enabled | 否 | 默认 true；false 暂停展示 |

作者、版本、描述、发布时间、README 和兼容范围由上游提供，不能在清单中覆盖。相同来源只能收录一次；不同来源解析成同一个包时会报告冲突。

## 收录标准

插件应解决明确问题，具备可安装的 DSH bundle、清晰的使用说明和可追溯的作者来源。PR 说明实际使用情况及已知限制即可；上游版本和 README 的后续维护由作者负责。

精选表示推荐，不自动表示逐版本兼容验证或安全认证。自动生成器只读取资料，不安装或运行插件。

## 提交前检查

本地环境与依赖准备见 [本地准备](docs/maintenance.md#本地准备)。

~~~bash
corepack pnpm check
corepack pnpm build
~~~

将生成的 `index.json` 与来源清单一起提交，在 PR 中注明检查结果。合入 `main` 后，流水线也会重新生成索引。构建需要联网，详见 [检查与生成索引](docs/maintenance.md#检查与生成索引)。

## 更新与移除

上游发布新版本、更新介绍后，重新运行 build 即可。无需新增版本记录，也无需修改精选清单。

更换推荐来源、调整标签或推荐理由，直接修改对应清单并提交 PR。用途标签由维护者指定，每个插件选择一至三个不重复的标签；新增标签须先在 catalog.yaml 声明中英文名称。上游关键词仅用于搜索。移除条目时删除文件或设置 enabled: false。

## 自动同步

仓库内 `index.json` 是生成产物，维护者不手工编辑其中的插件资料。同步方式与失败处理见 [自动同步](docs/maintenance.md#自动同步)。
