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
dsh-selfrepair doctor                 # 诊断并修复所有 profile —— 出问题时就用这一条
dsh-doctor doctor                     # 同上，短一点的二进制名
dsh-selfrepair                        # status，所有 profile（默认动作，绝不写入）
dsh-selfrepair status                 # 子命令下的只读报告
dsh-selfrepair fix --profile web      # 只修一个 profile（`doctor` 就是 `fix` 的别名）
dsh-selfrepair --fix --profile web    # --fix 即动作，无需位置参数
dsh-selfrepair fix --only llm-config  # 限定一个检查项
dsh-selfrepair restore --profile web  # 从备份撤销最近一次修复
dsh-selfrepair rollback --profile web # 回滚到上一个已知可用的配置
dsh-selfrepair status --json          # 机器可读输出
```

`doctor` 修复，`status` 只报告。dsh 坏掉时要用的那条命令必须把它修回可用，
而不是打印一份诊断——所以 `doctor` 会诊断、应用全部可修复项、再报告剩下的
问题。每次修复都先写备份，`restore` 可以回退。重链后的模块只在**新**进程里
生效，因此修复报告会点名仍持有旧副本的运行中 dsh 进程。

不健康时退出码为 1，可直接接健康检查——见
[`examples/healthcheck.sh`](examples/healthcheck.sh)；健康检查请用 `status`，
它是那个绝不写入的动作。

> **`dsh doctor` 在 dsh 0.1.5-rc.2 上不可用。** 0.1.5 的原版启动器只路由
> `web` 与 `plugin` 两个子命令；本 README 过去宣传的 `doctor` 路由是对已安装
> 启动器（`@deepseek-ai/dsh/lib/bin.js`）的本地补丁，升级 `dsh` 即被冲掉、每次
> 升级后都要手工重打。全局安装的 `dsh-selfrepair` / `dsh-doctor` 两个二进制
> 不受升级影响——请直接使用它们。

会话内斜杠命令（挂载本插件的 profile）：

```
/doctor           # 报告（默认）—— 绝不写入
/doctor fix       # 应用可修复项
/doctor restore   # 撤销最近一次修复
/doctor rollback  # 回滚到上一个已知可用的配置
```

## 每次修复都可撤销

无法撤销的修复比不修复更糟：这些操作动的是用户已安装的包和配置文件。每次
修复先写备份——换链的包移入 `.dsh-doctor-backup/<时间戳>/`，`settings.yaml`
复制为 `settings.yaml.doctor-backup`——`restore` 从其留下的备份精确撤销最近
一次修复。

## 上一个能用的配置

五项检查里有三项只报告，因为工具无法知道损坏的配置*原本想写什么*。但它可以
知道这份配置*原来是什么*：一次以健康收尾的修复运行会把 `settings.yaml` 与该
profile 的 `cordis.patch.yml` 记为 known-good 快照，`dsh-selfrepair rollback`
把最近一份放回去。

```bash
dsh-selfrepair doctor # 配好后跑这一次，可用状态就被记下了
# ……某次改动把配置弄坏了……
dsh-selfrepair rollback # 把记录下来的状态放回去
```

它能救回定点修复救不了的情况：`settings.yaml` 语法坏掉、默认模型指向不存在的
型号、手改坏的 `cordis.patch.yml`。快照存在
`.dsh-doctor-known-good/snapshots/<时间戳>/`（保留最近 5 份）；配置没变则沿用
原快照，所以时间戳表示状态**上一次发生变化**的时刻；回滚会把被覆盖的内容备份
到 `.dsh-doctor-known-good/pre-rollback/<时间戳>/`。

`restore` 与 `rollback` 回答的是两个问题：`restore` 撤销**本工具**上一次的修复；
`rollback` 撤销的是自配置上次可用以来、由任何人造成的破坏。

**`~/.dsh/.credentials.yaml` 永远不进快照。** 本工具只读凭据的键**名**、从不读值；
为了支持回滚而到处复制明文密钥库，是拿这条纪律换一点小便利。因此「provider 缺
API key」始终只报告，任何回滚都修不好它。

记录只发生在写入路径上：`detect` 永远不能写（设置页每次打开都会跑），所以快照
是在一次以健康收尾的修复运行末尾拍下的。

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
的软链——真实路径坍缩回同一实例。副本被*移动*进备份，绝不删除。

### 升级 dsh 会把每个 profile 推入这个状态

升级全局 `dsh` 会把整棵 `@deepseek-ai/*` 树换到新版本，而每个 profile 仍
持有 lockfile 锁定的旧副本——没人动过 profile，身份分裂就已经发生。版本不同
并不能让副本变得无害：harness 自己的模块图无论版本号如何，一个进程内只能有
一个实例。因此这些陈旧副本按**故障**报告，并重链到全局版本——这与照着升级后
的全局树重装一次得到的结果相同（报告会写明每个包的版本变化，`restore` 可以
回退）。

普通三方库则相反：两份 `zod` 完全可以共存，重链反而会静默替换插件构建时依赖
的版本，所以非 `@deepseek-ai/*` 的包版本不同就按设计保留本地副本。若 harness
副本与全局处于**不同发布线**（本地 `3.x` vs 全局 `4.x`），同样只报告不重链——
那种情况需要照着升级后的 `dsh` 重装该 profile。

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
npm test         # 149 个测试，无需网络、无需 dsh 安装
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
