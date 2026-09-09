# dsh-selfrepair 问题清单 —— 源自 2026-08-27 profile 事故复盘

> 交给 dsh-selfrepair 修复会话的问题清单。按优先级排序，每项含证据与修复建议。
> 事故由 dsh-freeroute 会话中的非常规操作触发（手改 profile package.json + 裸跑
> `pnpm install`），本工具的 duplicate-modules 检查在事故中**工作正常并完成了修复**。

## 处理记录（2026-08-27，本清单的修复会话）

- **问题 1 已修**：`credentialsKeys()` 读 version-1 布局的 `refs:` 键，顶层
  仅作预发布扁平布局的兼容回退（排除 `version`/`refs`/`records`）；函数与文件头
  注释同步修订；补 6 个回归用例（refs 命中、空集合不含布局键、扁平布局兼容等）。
- **问题 3 已修**：OK 摘要追加 `N version-diverged package(s) kept as local
  copies by design` 分句；detail 行从 `left alone:` 改为
  `kept as a local copy by design (versions differ, relinking would change
  the version): …`，不再能读成「有问题但没修」。
- **问题 2 采用方案 2**：新增 `lib/processes.js`（`ps ax` best-effort 探测，
  解析逻辑纯函数化可测）。`duplicate-modules` 的 fix/undo note 在检测到运行中
  dsh 进程时点名 PID（实测点名了本机的 `dsh web` 进程）；探测失败静默回退到
  原有通用提示。测试断言两种分支都保留 `Restart dsh` 措辞。
- **问题 2 方案 1 判定为上游缺口**：落点在 dsh CLI 全局安装
  （`lib/plugin-9h8shc4d.js`），不属于本仓库；且实证 `healProfilesModuleFallback`
  只治理共享层 `~/.dsh/profiles/node_modules`，不治本次事故发生的 per-profile 层
  （`~/.dsh/profiles/web/node_modules`）——这是精确的上游改进点，应提给
  deepseek-harness 仓库（在 `dsh plugin add` / reconcilePlugins 后追加
  per-profile duplicate 自检）。手改全局安装会在升级时丢失，不做。
- **问题 2 方案 3 判定为不可行**：pnpm-lock 以 registry 解析记录这些包
  （`@deepseek-ai/dsh-scope@0.1.0-rc.6` + peer 后缀实例），pnpm 没有
  「解析到外部目录」的受支持表达；改写 lock 会在任何一次 install 被重算覆盖。
  受支持的等价防护是在 package.json 用 `link:` 协议声明共享包（用户侧操作指引
  而非工具侧自动化），已在此记录，不实现。

## 背景：事故时间线（已自愈，作为回归案例记录）

| 时间 | 事件 |
|---|---|
| 10:57 | `~/.dsh/profiles/web/` 内手改 package.json + `pnpm install --no-frozen-lockfile`（在运行中的 server 下）→ 14 个 `@deepseek-ai/*` 包从「符号链接→全局安装」变成**真实重复副本** |
| ~11:00 | resume 任意 cordis preset 会话失败（症状见附录 A） |
| 11:08 | `doctor fix` 重建 14 个符号链接（dsh-scope / dsh-system-prompt / dsh-agent / dsh-llm / cordis 等） |
| 11:10 | 用户重启 GUI 进程 |
| 11:13 | 此前失败的会话成功恢复，正常运行至今 |

根因链：重复副本 → `dsh-scope` 的 scope 注册表（模块私有 WeakMap）跨副本不可见 →
preset 的 persona 行 scope 解析得 undefined → 落到**全局** prompt 层注册 → 与
`SystemPrompt` 构造器无条件注册的全局 `deployment:persona` 相撞 → resume 报错。

---

## 问题 1（bug，优先修）：api-key 检查全量误报

**现状**：4 个 provider（vol / liepin / liepin-aiproxy / opencode）全部被判
「API key 不存在」WARN。**全部是误报**：key 实际都在，且 liepin 正在服务真实会话。

**根因**：`lib/checks/api-key.js` 的 `credentialsKeys()`（第 23–29 行）：

```js
const { value } = parseSettingsYaml(readFileSync(path, 'utf8'));
// ...
return new Set(Object.keys(value));   // ← 只取顶层键
```

而 `~/.dsh/.credentials.yaml` 的正式布局（`dsh-credentials-local` lib/index.js
150–154 行实证）是 **version-1 嵌套布局**：

```yaml
version: 1
refs:
  VOL_API_KEY: ...
  LIEPIN_API_KEY: ...     # 15 个凭证全部在 refs: 下
```

顶层只有 `version` / `refs`（/ `records`），所以 `Object.keys(value)` 永远匹配不到
任何 `apiKeyEnv`——**每个声明了 apiKeyEnv 的 provider 都必然误报**。文件头注释声称
「mirrors that resolution exactly」目前不成立：真正的解析走 `refs` 命名空间。

**修复建议**（保持只读键名、不读值的纪律）：

```js
const keys = new Set(Object.keys(value.refs ?? {}));
// 兼容预发布扁平布局（顶层直接是键；dsh-credentials-local 对这种布局会直接 throw，
// 但检查器宽容处理无害）：
for (const k of Object.keys(value)) {
  if (k !== 'version' && k !== 'refs' && k !== 'records') keys.add(k);
}
return keys;
```

同步修订：函数 doc 注释、api-key.js 头部第 10–11 行的「keys of ~/.dsh/.credentials.yaml」
表述改为「credential 引用名（version-1 布局下为 `refs` 的键）」。

**回归测试缺口**：`test/` 中 grep 不到任何 `refs` 布局用例（已验证）。修完至少补：
- version-1 布局：`{version: 1, refs: {FOO_API_KEY: 'x'}}` → 命中 FOO_API_KEY
- 顶层只含 version/refs 时 → 集合为空而非 `['version','refs']`

---

## 问题 2（增强）：布局损坏的「事前」防护窗口

本次事故从 install（10:57）到修复（11:08）有 **11 分钟窗口**，期间所有 cordis
preset 会话的 resume 必挂，而用户看到的报错（persona 双注册）完全无法指向根因。

**建议**（择一或组合）：
1. harness 侧 `dsh plugin` 命令（`plugin-9h8shc4d.js` 的 `reconcilePlugins()` 之后）
   追加一次 duplicate-modules 自检并自动符号链接归一——把防护放进**受支持的安装
   路径本身**，覆盖「上一代安装已损坏，现在经规范路径重装」的场景。
2. `doctor fix` 完成修复后，若检测到运行中的 dsh 进程，明确提示「符号链接已重建，
   但运行中的进程仍持有旧副本，需重启生效」——本次若无 11:10 的手动重启，修复
   不会生效。
3. （需验证可行性）修复时同步校正 `pnpm-lock.yaml` 中指向重复副本的记录，避免
   下一次 install 复发。

---

## 问题 3（低优先，文案）：zod 双版本的展示歧义

duplicate-modules 检查输出 `OK`，但摘要里混着一行
`left alone: zod (local 3.25.76 vs global 4.4.3)`。行为本身正确（版本不同不能
符号链接共享），但「OK 摘要里夹一行 left alone」容易被读成「有问题但没修」。
建议区分文案：`OK（1 个版本不同的包按设计保留本地副本: zod 3.25.76 ≠ 全局 4.4.3）`。

---

## 附录 A：症状签名与最小复现

**症状签名**（可用于将来把此类报错直接关联到 duplicate-modules）：

```
agent-presets: preset "cordis" failed to mount: failed to apply loader entry
persona (@deepseek-ai/dsh-persona): prompt section "deployment:persona" is
already registered (for a per-agent override, register through that agent's
`agent.ctx` instead)
```

判别要点：错误消息是**无 scope 变体**（"already registered"，而非
"already registered in this scope"）→ persona 行的 ctx 丢失了 scope →
几乎必然是模块身份分裂 → 直接指向 duplicate-modules。

**最小复现**：

```bash
cd ~/.dsh/profiles/web
# 1. 制造重复副本
python3 - <<'EOF'
import json
p = json.load(open('package.json'))
p['dependencies']['<某@deepseek-ai包或触发重解析的任意改动>'] = 'x'
json.dump(p, open('package.json','w'), indent=2)
EOF
rm node_modules/@deepseek-ai/dsh-scope          # 拆掉一个符号链接
pnpm install --no-frozen-lockfile               # 裸 install 重建为真实副本
# 2. resume 任意 cordis preset 会话 → 附录 A 报错
# 3. dsh doctor fix → 符号链接重建
# 4. 重启进程 → resume 恢复
```

**相关文件**：
- 误报 bug：`lib/checks/api-key.js:23-29`（`credentialsKeys`）
- 布局权威定义：harness 安装内 `@deepseek-ai/dsh-credentials-local/lib/index.js:127-155`
- 防护增强落点：harness `lib/plugin-9h8shc4d.js`（`reconcilePlugins`）
