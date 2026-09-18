#!/usr/bin/env node
// publish-both — 双名并轨发布：dsh-recovery（主名）+ dsh-selfrepair（既装用户的维护名）。
//
// 一个代码库、两个 npm 包名、同一版本号同步发布。主名就地发布；维护名在临时目录
// 里改写 name 与 README 更名说明后发布，tarball 其余内容与主名一致。
//
// 用法：
//   node scripts/publish-both.mjs            # 两个名字都发布（已发布的版本自动跳过）
//   node scripts/publish-both.mjs --dry-run  # 只显示将做什么
//
// 说明：npm 不支持原地改名，双名并轨是"旧名不流失既有用户"的最低成本方案。
// 版本号永远两包同步；registry 查重让脚本可以重复执行。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const primary = pkg.name;                    // dsh-recovery
const twin = 'dsh-selfrepair';               // 维护名（既有安装的延续）
const version = pkg.version;
const dryRun = process.argv.includes('--dry-run');

const run = (cmd, args, cwd = root) => {
  if (dryRun) { console.log(`[dry] ${cmd} ${args.join(' ')} (cwd=${cwd})`); return ''; }
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
};

const publishedVersions = (name) => {
  try {
    return JSON.parse(execFileSync('curl', ['-s', '--fail', `https://registry.npmjs.org/${name}`], { encoding: 'utf8' }));
  } catch { return { versions: {} }; }
};

const twinRegistry = publishedVersions(twin);
const primaryRegistry = publishedVersions(primary);

if (primaryRegistry.versions[version]) {
  console.log(`= ${primary}@${version} 已在 registry，跳过主名发布`);
} else {
  console.log(`→ 发布 ${primary}@${version}（就地）`);
  run('npm', ['publish', '--no-provenance']);
}

if (twinRegistry.versions[version]) {
  console.log(`= ${twin}@${version} 已在 registry，跳过维护名发布`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), `${twin}-pub-`));
  try {
    cpSync(root, tmp, {
      recursive: true,
      filter: (src) => !/(^|[\\/])(node_modules|\.git|\.dsh-doctor-known-good)$/.test(src)
        && !/(^|[\\/])package-lock\.json$/.test(src),
    });
    const p = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
    p.name = twin;
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(p, null, 2) + '\n');
    // README 更名说明改为"双包并轨"口径
    for (const readme of ['README.md', 'README.zh.md']) {
      const f = join(tmp, readme);
      let s = readFileSync(f, 'utf8');
      s = s.replace(
        /本包原名 `dsh-selfrepair`，现更名 \*\*`dsh-recovery`\*\*。旧名保留在 npm（已 deprecate）并继续提供 `dsh-selfrepair` bin 供既有安装使用；新安装请用 `dsh-recovery`（bin：`dsh-recovery`、`dsh-doctor`）。/,
        '本包与 `dsh-recovery` 是**同一代码库的双名并轨发布**：`dsh-recovery` 是今后主名，`dsh-selfrepair` 面向既有安装长期同步维护，两包版本号永远一致。',
      );
      s = s.replace(
        /\*\*Renamed in 0\.6\.0:\*\* this package was `dsh-selfrepair`; it is now \*\*`dsh-recovery`\*\*\. The old name stays on npm \(deprecated\) and keeps shipping the `dsh-selfrepair` bin for existing installs; new installs should use `dsh-recovery` \(bins: `dsh-recovery`, `dsh-doctor`\)\./,
        '**Dual-name release since 0.6.0:** `dsh-recovery` and `dsh-selfrepair` ship the same code from one repository — `dsh-recovery` is the primary name going forward, `dsh-selfrepair` stays as the long-term maintained name for existing installs. Versions always match.',
      );
      writeFileSync(f, s);
    }
    console.log(`→ 发布 ${twin}@${version}（临时目录改写 name）`);
    run('npm', ['publish', '--no-provenance'], tmp);
  } finally {
    if (!dryRun) rmSync(tmp, { recursive: true, force: true });
  }
}
console.log('完成。');
