# Nex 精选插件

Nex 官方维护的精选插件目录，收录社区插件和 Nex 自研插件。插件由原作者在 GitHub 或 npm 发布；本仓库维护收录来源、用途标签、推荐理由和排序，基础资料自动从上游读取。

只有 plugins 中明确登记且启用的来源会进入客户端目录。自动同步只刷新这些插件的资料和版本，不会扫描社区并自动新增收录。

## 收录一个插件

在 plugins 中新增一份 YAML 即可：

~~~yaml
source: "@author/dsh-example"
tags: [research]
recommendation: "适合文献阅读和资料整理。"
~~~

GitHub 来源使用仓库地址：

~~~yaml
source: https://github.com/author/dsh-example
tags: [media, creator]
~~~

以上为格式示例。每个插件从 [catalog.yaml](catalog.yaml) 中选择一至三个不重复的用途标签。完整字段与标签维护方式见 [贡献说明](CONTRIBUTING.md)。

社区插件默认 origin: community，自研插件可添加 origin: official；该字段只区分“社区开发 / Nex 自研”，所有收录条目都属于 Nex 精选。单仓库多包可添加 path: packages/example。文件名自定，包名、作者、简介、图标和版本无需人工填写。

也可以使用命令确认来源后生成清单：

~~~bash
fnm use
corepack pnpm install --frozen-lockfile
corepack pnpm plugin:add @author/dsh-example --tag research
corepack pnpm plugin:add https://github.com/author/dsh-example --tag media --tag creator --origin official
~~~

## 信息从哪里来

| 内容 | 来源 |
| --- | --- |
| 收录与否、用途标签、推荐理由、排序 | 本仓库的精选清单 |
| 包名、作者、许可证、主页 | 原包的 package.json |
| 名称、简介、图标 | 原包的 locale 元数据及 package.json；缺少图标时尝试原 GitHub 仓库所有者头像 |
| npm 版本、发布时间和兼容范围 | npm registry 及对应版本 manifest |
| GitHub 版本和提交 | 仓库默认分支的 package.json 与实际提交 |
| 详细介绍、使用方法及配图 | 原包的 meta.detail、README，或原仓库 README |
| 实际安装内容 | npm 或原 GitHub 仓库 |

详情读取遵循 DSH plugin-detail 规则：优先语言文件指定的 meta.detail，其次包 README，最后尝试原仓库 README。安装版本由 npm 或 GitHub 元数据解析。

## 检查与生成

~~~bash
corepack pnpm check
corepack pnpm build
corepack pnpm plugin:inspect plugins/实际文件名.yaml
corepack pnpm plugin:readme plugins/实际文件名.yaml --language zh
~~~

check 检查类型、测试和精选清单，不需要外网。build 联网读取来源，生成根目录 index.json。生成文件可以提交到 Git 仓库，不需要手工修改。

索引遵循 DSH format 1，并通过 DSH 官方校验器验证。npm 来源列出仍可用的公开 bundle 版本；GitHub 来源跟随默认分支，并在每次生成时固定到完整提交。安装参数使用索引内的精确版本或提交，实际兼容性由 DSH 安装器再次检查。条目的 nex 扩展保存推荐理由、来源归属及上游许可证信息。

用途标签写入 DSH 标准 metadata.labels，首个标签同时作为 metadata.category，供客户端和镜像读取。Nex 客户端支持按标签筛选，卡片最多显示三个用途标签。

任何启用来源读取失败时，构建失败并保留原 index.json。上游新版本在构建时自动同步。

## 客户端读取

公开仓库通过 GitHub Raw 提供根目录 index.json：

~~~text
https://raw.githubusercontent.com/xhznAI/nex-plugin/main/index.json
~~~

客户端读取索引，再通过 DSH 原生安装与详情接口访问原包或仓库。需要使用能直接返回 JSON 的地址，避免重定向。

Check 流水线在推送和 PR 上执行检查与联网构建。Sync index 流水线在 main 的来源清单或工具变化、手动触发以及每日定时运行时，重新生成并提交 index.json；仅文件内容变化时提交。自动同步使用 GitHub Actions 内置令牌。若 main 禁止机器人直接提交，可手动运行 build 后通过 PR 更新索引。

## 下架与贡献

删除收录文件，或添加 enabled: false，下一次构建就会移除该条目。客户端已安装的插件继续由本机管理。

投稿方式与字段见 [贡献说明](CONTRIBUTING.md)。examples 仅提供格式示例，不参与索引。

## 协议参考

- [DSH 插件索引说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.md)：标准索引、来源和客户端行为。

工具代码采用 MIT。收录不改变原插件的作者、归属或许可证。
