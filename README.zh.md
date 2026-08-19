# dsh-selfrepair

[![npm](https://img.shields.io/npm/v/dsh-selfrepair.svg)](https://www.npmjs.com/package/dsh-selfrepair)
[![CI](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）提供安装诊断与自修复。**

五项检查，专抓那些症状与病因毫无关联的故障——插件挂载失败、模型找不到、启动时静默回退——可修复项全部支持备份与撤销。

[English](README.md) | 中文

## 它做什么

三个修复入口，一个引擎：

| 入口 | 位置 | dsh 起不来时可用 |
|---|---|---|
| **诊断设置页** | `dsh web` -> 设置 -> 诊断 | 否 |
| **`/doctor` 斜杠命令** | 任意 dsh 会话内 | 否 |
| **`dsh-selfrepair` CLI** | 任意终端 | **是** |

CLI 是主入口，这是刻意设计：本工具修复的最严重故障会让 dsh 连提示符都到不了，斜杠命令恰恰在最需要的时候够不着。

| 检查项 | 发现什么 | 自动修复 |
|---|---|---|
| `duplicate-modules` | 遮蔽全局 dsh 安装的 profile 包——两套依赖注入系统、所有 agent preset 挂载失败 | ✅ 换软链 + 备份 |
| `llm-config` | 静默顶掉可用默认值的杂散 `llm-*` 键（如 `baseURL: "11111"`） | ✅ 删坏键 + 备份 |
| `settings-yaml` | `settings.yaml` 无法解析，并指出坏掉的具体块 | 仅报告 |
| `agent-default-model` | 默认模型不在所选 provider 的 `models:` 列表里 | 仅报告 |
| `api-key` | provider 的 `apiKeyEnv` 在凭据库和环境变量里都不存在 | 仅报告 |

「仅报告」是刻意为之：这三项工具无法猜出损坏的配置*原本想写什么*。只读键**名**，永远不读值。

## 安装

需要 Node.js ≥ 20 与 `dsh` CLI（`npm i -g @deepseek-ai/dsh`）。

一条命令装进 profile——安装包、同步 `dsh.profile.bundles`、并组合包自带的
bundle patch（挂载本插件的那一行）：

```bash
dsh plugin --profile web add dsh-selfrepair
```

重启一次 `dsh web`，**设置 -> 诊断** 就会出现。

独立 CLI 不需要任何 profile——全局装一次，留作救援通道：

```bash
npm install -g dsh-selfrepair
dsh-selfrepair status          # 诊断找到的所有 profile
```

<details>
<summary>手动安装（不用 <code>dsh plugin</code>）</summary>

```bash
cd ~/.dsh/profiles/<name>
npm install dsh-selfrepair
```

再往 `~/.dsh/profiles/<name>/cordis.patch.yml` 加一行：

```yaml
- insert:
    - id: plugin-selfrepair
      name: 'dsh-selfrepair'
```

`insert` 是新增；单独的 `- id:` 是*修改已有条目*，会报
`patch: entry "..." not found`。

</details>

## 诊断设置页

页面默认只读——打开即检查，但绝不写入。只有发现问题的检查项才会列出；
健康的安装只显示一个 **一切正常**，别无其他。

顶部可切换两种检测模式：

- **AI 检测**（配置了可用默认模型时默认）：先跑规则检查，再把证据——环境
  路径、每条规则结果、`settings.yaml` 原文（只有键名，永不含凭据值）——交给
  默认模型做第二意见，以「AI 分析」卡片展示。模型调用失败自动降级为纯规则视图。
- **规则检测**：仅五项检查。

**重新检查** 与 **一键修复** 位于右下角固定操作栏，页面滚动时不动。单项修复
原地二次确认（点两下）；一键修复是一次郑重的点击，应用全部可修复项。

## CLI 参考

```bash
dsh-selfrepair                       # status，所有 profile
dsh-selfrepair status --profile web  # 单个 profile
dsh-selfrepair fix --profile web     # 应用可修复项
dsh-selfrepair --fix --profile web   # --fix 即动作，无需位置参数
dsh-selfrepair fix --only llm-config # 限定一个检查项
dsh-selfrepair restore --profile web # 从备份撤销最近一次修复
dsh-selfrepair status --json         # 机器可读输出
```

不健康时退出码为 1，可直接接健康检查——见
[`examples/healthcheck.sh`](examples/healthcheck.sh)。

会话内斜杠命令（挂载本插件的 profile）：

```
/doctor          # 报告（默认）—— 绝不写入
/doctor fix      # 应用可修复项
/doctor restore  # 撤销最近一次修复
```

## 每次修复都可撤销

无法撤销的修复比不修复更糟：这些操作动的是用户已安装的包和配置文件。每次
修复先写备份——换链的包移入 `.dsh-doctor-backup/<时间戳>/`，`settings.yaml`
复制为 `settings.yaml.doctor-backup`——`restore` 从其留下的备份精确撤销最近
一次修复。

## 最严重的故障是怎么发生的

把 `@deepseek-ai/*` 声明为普通**依赖**（而非 peerDependencies）的 profile
插件，会让 pnpm 在 profile 的 `node_modules` 里装出第二份真实的 dsh 树——
包括 `@deepseek-ai/cordis` 本身。Node 以解析后的真实路径作为 ESM 模块身份，
于是 profile 里跑起了两套依赖注入系统，一边注册的服务另一边不可见：

```
@deepseek-ai/dsh-base   (全局)  -> 全局 cordis，全局 dsh-system-prompt
dsh-acp-server          (本地)  -> 本地 cordis，本地 dsh-system-prompt
```

所有 agent preset 挂载失败：`prompt section "deployment:persona" is
already registered`，任何会话都起不来。修复方式是把每个副本换成指向全局包
的软链——真实路径坍缩回同一实例。副本被*移动*进备份，绝不删除；本地版本与
全局不一致的包只报告不动——重链会静默替换插件构建时依赖的版本。

### 为什么 peer 是 `optional`

dsh 每次启动都会把自己的依赖树软链进共享的 `~/.dsh/profiles/node_modules/`
回退层，因此把 `@deepseek-ai/*` 声明为 **optional** peer 的插件会解析到 dsh
自身运行的*同一实例*——一套依赖注入系统。npm 一旦在插件旁边装出真实副本，
真实路径身份分裂，`duplicate-modules` 故障立刻复发。Optional peer 让治愈
手段不会变成病因。

## 新增一个检查项

`lib/checks/*.js`，注册进 `lib/checks/index.js`——完整契约见
[`lib/types.d.ts`](lib/types.d.ts)：

```js
export const myCheck = {
  id: 'my-check',
  title: 'Human readable title',
  severity: 'critical',        // 或 'warning'
  fixable: true,
  detect(env) {                // env = { profileRoot, globalRoot, dshHome }
    return { ok: false, summary: '...', detail: ['...'], findings: [...] };
  },
  fix(env, findings) {         // 先备份，再写入
    return { fixed: ['...'], failed: [], note: 'backup: ...' };
  },
  undo(env) {                  // 可选：启用 `restore`
    return { restored: ['...'], failed: [] };
  },
};
```

`detect` 绝不写入：报告可以随时安全运行。抛错的检查会被当作一条失败结果
报告，而不是中断整个运行——一个坏探针不能掩盖其余诊断。

## 开发

```bash
git clone https://github.com/dushaobindoudou/dsh-selfrepair.git
cd dsh-selfrepair
npm install
npm test         # 84 个测试，无需网络、无需 dsh 安装
npm run typecheck
```

测试在沙盒里复现两种原始故障，并断言完整的 修复 -> 撤销 往返。

软链开发安装挂进 profile 时，把协议 peer 指向运行中 dsh 自己的那份（与兄弟
插件同一做法），保证两端共享同一实例：

```bash
G=$(dirname $(realpath $(which dsh)))/../lib/node_modules/@deepseek-ai/dsh/node_modules
ln -sfn "$G/@deepseek-ai/dsh-typert-protocol" node_modules/@deepseek-ai/dsh-typert-protocol
```

## 参与贡献

欢迎 PR——见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请走
[SECURITY.md](SECURITY.md)。

## 许可

[MIT](LICENSE)
