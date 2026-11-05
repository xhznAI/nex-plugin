# 维护与接入

[← 回到首页](../README.md) · [贡献指南](../CONTRIBUTING.md)

## 本地准备

使用 Node.js 24、Corepack 和 pnpm 11.25.0。Node.js 版本由仓库根目录的 `.nvmrc` 指定，可通过 fnm 或 nvm 选择。以下命令在仓库根目录执行：

```sh
fnm use
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

`check` 执行类型检查、测试和来源清单校验，不需要访问外网。

## 收录与调整

在 `plugins/` 中为每个来源新增一份 YAML：

```yaml
source: "@author/dsh-example"
tags: [research]
recommendation: "适合文献阅读和资料整理。"
```

GitHub 来源填写公开仓库地址：

```yaml
source: https://github.com/author/dsh-example
tags: [media, creator]
```

以上为格式示例。每个插件从 [catalog.yaml](../catalog.yaml) 中选择一至三个不重复的用途标签；新增标签先声明中英文名称。

社区插件使用默认的 `origin: community`，Nex 自研插件使用 `origin: official`。单仓库多包可设置 `path: packages/example`。字段说明见 [清单格式](../CONTRIBUTING.md#清单格式)。

也可以使用 CLI 校验来源并生成清单，将下列示例来源替换成实际插件：

```sh
corepack pnpm plugin:add @author/dsh-example --tag research
corepack pnpm plugin:add https://github.com/author/dsh-example --tag media --tag creator --origin official
```

修改对应 YAML 可以调整标签、推荐理由和排序。删除文件或设置 `enabled: false` 后，下一次构建会从目录移除该插件；客户端已安装的插件继续由本机管理。`examples/` 只提供格式示例，不参与索引。

## 资料来源

| 内容 | 来源 |
| --- | --- |
| 收录范围、用途标签、推荐理由和排序 | 本仓库的来源清单 |
| 包名、作者、许可证和主页 | 原包的 `package.json` |
| 名称、简介和图标 | 原包的 locale 元数据及 `package.json`；缺少图标时尝试公开 GitHub 仓库所有者头像 |
| npm 版本、发布时间和兼容范围 | npm registry 与对应版本 manifest |
| GitHub 版本与提交 | 默认分支的 `package.json` 与实际提交 |
| 详细介绍、使用方法与配图 | 原包的 `meta.detail`、README，或原仓库 README |
| 插件安装内容 | npm 或原 GitHub 仓库 |

基础资料与版本由上游提供。用途标签由维护者指定，上游关键词用于搜索。GitHub 仓库所有者头像只作图标回退，作者信息仍来自原包声明。

详情读取遵循 DSH `plugin-detail` 规则：优先语言文件指定的 `meta.detail`，其次包 README，最后尝试原仓库 README。

## 检查与生成索引

```sh
corepack pnpm check
corepack pnpm build
```

`build` 联网读取启用的来源，生成根目录 `index.json`。npm 来源列出仍可用的公开 bundle 版本；GitHub 来源跟随默认分支，并在索引中固定到完整提交。上游新版本在构建时自动同步。

生成文件可以随来源清单提交，无需手工编辑。任何启用来源读取失败时，构建失败并保留原 `index.json`。

检查某个来源解析出的信息和使用说明：

```sh
corepack pnpm plugin:inspect plugins/dsh-zotero.yaml
corepack pnpm plugin:readme plugins/dsh-zotero.yaml --language zh
```

构建和来源检查需要访问 npm registry、包文件 CDN 与 GitHub API。本地 GitHub API 配额不足时可提供 `GITHUB_TOKEN`，工具只将其发送至 `api.github.com`。

## 客户端与镜像接入

公开索引地址：

```text
https://raw.githubusercontent.com/xhznAI/nex-plugin/main/index.json
```

索引遵循 DSH `format: 1`，构建时使用 DSH 官方校验器验证。客户端读取索引后，通过 DSH 原生安装与详情接口访问原包或仓库；安装参数使用索引中的精确版本或提交，兼容性由安装器再次检查。

以下字段位于插件条目（`plugins[]`）中：

| 字段 | 用途 |
| --- | --- |
| `metadata.labels` | 插件用途标签的 ID 列表 |
| `metadata.category` | 插件的首个用途标签，供原生分类读取 |
| `metadata.keywords` | 上游搜索关键词 |
| `nex.recommendation` | Nex 精选理由 |
| `nex.origin` | 开发者归属：`community` 或 `official` |
| `nex.license` | 上游声明的许可证（如有） |

标签的中英文名称在索引根级 `metadata.labels` 中声明。Nex 客户端支持按任意一个用途标签筛选。`nex` 为条目扩展，标准插件安装仍使用 DSH 索引字段。

镜像可原样同步 `index.json`，通过直接返回 JSON 的公开地址提供访问。保留来源地址、版本、提交和扩展字段；镜像索引只改变目录读取位置，插件仍从索引记录的来源安装。

协议说明见 [DSH 插件索引文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)。

## 自动同步

| 流水线 | 触发方式 | 行为 |
| --- | --- | --- |
| [Check](../.github/workflows/check.yml) | 推送或 PR | 执行检查与联网构建，保留生成索引为构建产物 |
| [Sync index](../.github/workflows/sync.yml) | `main` 的来源清单或工具变化、手动触发、每日定时 | 重新生成索引，仅在内容变化时提交 `index.json` |

同步只刷新已收录并启用的来源，收录名单由维护者确定。自动提交使用 GitHub Actions 内置令牌与机器人身份。

若 `main` 禁止机器人直接提交，可在本地运行 `build` 后通过 PR 更新索引。同步失败不会覆盖当前索引；修复网络或来源后重试 [Sync index](https://github.com/xhznAI/nex-plugin/actions/workflows/sync.yml)。
