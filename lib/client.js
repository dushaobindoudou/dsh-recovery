/**
 * dsh-selfrepair - client half (web).
 *
 * Registers the "诊断 / Doctor" settings page (settings.section). Talks to the
 * host `doctor` Remote namespace through the connection RPC carrier, so the
 * page and the terminal run the exact same diagnosis.
 *
 * Behavior contract with the user:
 *  - Only the checks that found a problem are listed; a healthy install shows
 *    a single "all clear" hero and nothing else.
 *  - The action bar lives bottom-right and stays fixed (sticky) while the page
 *    content scrolls.
 *  - Two detection modes: AI (host runs the rule checks AND asks the default
 *    model for a second opinion) and rules-only. AI is the default when the
 *    host reports it available, rules otherwise.
 *  - Opening the page never writes. Every write is explicit and confirms in
 *    place (click twice), and every one of them is reversible.
 *
 * Localization goes through the host `locale` service — dictionaries are
 * registered under this plugin's namespace and the host hands the bound `t`
 * to the section component, the same contract every first-party
 * `@deepseek-ai/dsh-client-ui-*` settings tab uses. A fallback lookup keeps
 * the page readable on a host that predates the injection, because a
 * diagnostics page that cannot render is worthless exactly when it is needed.
 *
 * Colors come from the host's `--dsw-alias-*` design tokens, which are
 * redefined under `body[data-ds-dark-theme]`. Two rules follow from that and
 * are easy to get wrong: `--dsw-alias-brand-primary` is near-black in light
 * mode and near-white in dark mode, so text on a brand fill must be
 * `--dsw-alias-label-primary-foreground` (which flips with it) and never a
 * literal white; and the warning token is `state-warn-primary`, not
 * `state-warning-primary` — the latter resolves to nothing and silently erases
 * whatever it colors.
 */
window.__ModuleLoader__.load({
  id: 'dsh-selfrepair',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const React = react;
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.doctor';

    /**
     * Simplified Chinese dictionary and key source of truth.
     *
     * `localeCode` is a real entry, not a marker hack for its own sake: the
     * host binds `t` but exposes no current-language getter, and the AI
     * analysis has to be requested in the language the reader is reading.
     */
    const zh = {
      localeCode: 'zh',
      tab: '诊断',
      subtitle: 'Doctor',
      modeAi: 'AI 检测',
      modeRules: '规则检测',
      loading: '正在运行诊断…',
      rechecking: '诊断中…',
      recheck: '重新检查',
      allClear: '一切正常',
      allClearHint: '{count} 项检查全部通过',
      allClearHintAi: '{count} 项检查全部通过，AI 分析见下',
      problems: '发现 {count} 个问题',
      problemsFixable: '发现 {count} 个问题，其中 {fixable} 个可一键修复',
      fix: '修复',
      fixing: '修复中…',
      confirmFix: '再次点击确认修复',
      fixAll: '一键修复 ({count})',
      restore: '撤销上次修复',
      restoring: '撤销中…',
      confirmRestore: '再次点击确认撤销',
      rollback: '回滚到上次可用配置',
      rollingBack: '回滚中…',
      confirmRollback: '再次点击确认回滚',
      knownGoodAt: '已记录可用配置：{at}',
      knownGoodNone: '尚未记录可用配置 —— 安装健康时修复一次即可记录',
      restartHint: '已改动磁盘，重启 dsh 后生效。',
      severityCritical: '关键',
      severityWarning: '警告',
      severityInfo: '信息',
      aiTitle: 'AI 分析',
      aiModelFallback: '模型',
      aiHint: '规则检查之外的模型第二意见',
      aiRunning: 'AI 分析中…',
      aiFailed: 'AI 分析失败：{error}',
      aiUnavailable: 'AI 不可用（{reason}），已使用规则检测',
      aiUnknownReason: '未知原因',
      aiNeedsRestart: 'AI 检测需要重启 dsh web 后生效：当前进程加载的是旧版插件宿主代码',
      connectionNotReady: '连接服务尚未就绪',
      callFailed: '调用失败',
      unexpectedResponse: '意外的 RPC 响应',
      nothingToFix: '没有可修复的问题。',
      nothingToRestore: '没有可撤销的修复。',
      nothingToRollback: '没有可回滚的配置。',
      rolledBackTo: '已回滚到 {at} 记录的配置',
      sharedSettings: 'settings.yaml 位于 dsh home，为所有 profile 共用。',
      checkDuplicateModules: '与全局 dsh 安装重复的 profile 包',
      checkLlmConfig: 'settings.yaml 中不可用的模型配置',
      checkSettingsYaml: 'settings.yaml 可解析且顶层结构正确',
      checkAgentDefaultModel: 'agent-default-model 指向可用的 provider 与模型',
      checkApiKey: '已配置的 provider 都能取到 API key',
      checkBrokenLinks: '失效的 profile 挂载路径（悬空 link:/file: 与 symlink）',
    };

    /** English dictionary; keys mirror {@link zh} exactly. */
    const en = {
      localeCode: 'en',
      tab: 'Doctor',
      subtitle: 'Diagnostics',
      modeAi: 'AI check',
      modeRules: 'Rule check',
      loading: 'Running diagnosis…',
      rechecking: 'Checking…',
      recheck: 'Re-check',
      allClear: 'All clear',
      allClearHint: 'all {count} checks passed',
      allClearHintAi: 'all {count} checks passed — AI analysis below',
      problems: '{count} problem(s) found',
      problemsFixable: '{count} problem(s) found, {fixable} of them fixable in one click',
      fix: 'Fix',
      fixing: 'Fixing…',
      confirmFix: 'Click again to confirm',
      fixAll: 'Fix all ({count})',
      restore: 'Undo last fix',
      restoring: 'Undoing…',
      confirmRestore: 'Click again to confirm undo',
      rollback: 'Roll back to last working config',
      rollingBack: 'Rolling back…',
      confirmRollback: 'Click again to confirm rollback',
      knownGoodAt: 'Known-good configuration recorded {at}',
      knownGoodNone: 'No known-good configuration recorded yet — one is recorded when a repair run leaves the install healthy',
      restartHint: 'Disk changed; restart dsh for it to take effect.',
      severityCritical: 'critical',
      severityWarning: 'warning',
      severityInfo: 'info',
      aiTitle: 'AI analysis',
      aiModelFallback: 'model',
      aiHint: 'A model second opinion beyond the rule checks',
      aiRunning: 'Analyzing…',
      aiFailed: 'AI analysis failed: {error}',
      aiUnavailable: 'AI unavailable ({reason}); rule check used instead',
      aiUnknownReason: 'unknown reason',
      aiNeedsRestart: 'AI check needs a `dsh web` restart: this process loaded an older build of the plugin host',
      connectionNotReady: 'The connection service is not ready yet',
      callFailed: 'Call failed',
      unexpectedResponse: 'Unexpected RPC response',
      nothingToFix: 'Nothing to fix.',
      nothingToRestore: 'No fix to undo.',
      nothingToRollback: 'No configuration to roll back to.',
      rolledBackTo: 'Rolled back to the configuration recorded {at}',
      sharedSettings: 'settings.yaml lives in the dsh home and is shared by every profile.',
      checkDuplicateModules: 'Profile packages duplicating the global dsh install',
      checkLlmConfig: 'Unusable model configuration in settings.yaml',
      checkSettingsYaml: 'settings.yaml is valid YAML with a well-formed top level',
      checkAgentDefaultModel: 'agent-default-model selects a usable provider and model',
      checkApiKey: 'Configured providers have an API key available',
      checkBrokenLinks: 'Broken profile mount paths (dangling link:/file: and symlinks)',
    };

    /** Check id -> dictionary key, so card titles follow the reader's language. */
    const CHECK_TITLE_KEY = {
      'duplicate-modules': 'checkDuplicateModules',
      'llm-config': 'checkLlmConfig',
      'settings-yaml': 'checkSettingsYaml',
      'agent-default-model': 'checkAgentDefaultModel',
      'api-key': 'checkApiKey',
      'broken-links': 'checkBrokenLinks',
    };

    const SEVERITY_KEY = { critical: 'severityCritical', warning: 'severityWarning', info: 'severityInfo' };

    /** Fill `{name}` placeholders the way the host's own `t` does. */
    const interpolate = (text, params) => (params === undefined
      ? text
      : String(text).replace(/\{(\w+)\}/g, (whole, key) => (params[key] === undefined ? whole : String(params[key]))));

    /**
     * A `t` for hosts that do not inject one.
     *
     * The page must render on a host older than the locale injection, so the
     * fallback picks a dictionary from the document language rather than
     * failing. Chinese unless the document says otherwise, matching the
     * audience this plugin shipped for first.
     */
    const fallbackT = () => {
      let lang = '';
      try {
        lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
      } catch {
        lang = '';
      }
      const dict = lang.startsWith('en') ? en : zh;
      return (key, params) => interpolate(dict[key] === undefined ? key : dict[key], params);
    };

    const CSS = [
      '.dc-page{font-size:13.5px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px;max-width:720px}',
      '.dc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dc-title{font-size:16px;font-weight:600;margin-right:auto;display:flex;align-items:center;gap:8px}',
      '.dc-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dc-modes{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dc-mode{border:none;background:transparent;color:var(--dsw-alias-label-secondary);height:26px;padding:0 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;white-space:nowrap}',
      '.dc-mode:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      // `brand-primary` is near-black in light mode and near-white in dark
      // mode; `label-primary-foreground` is the label that flips with it. A
      // literal white here is invisible on the dark-mode chip.
      '.dc-mode-active{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
      // Specificity must beat `.dc-mode:hover:not(:disabled)` above, or the
      // active chip's label takes the hover color on its brand background.
      '.dc-mode.dc-mode-active:hover{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}',
      '.dc-mode:disabled{opacity:.45;cursor:not-allowed}',
      '.dc-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}',
      '.dc-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dc-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dc-btn-danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.dc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}',
      '.dc-btn:disabled{opacity:.5;cursor:default}',
      // The host's focus ring, so keyboard traversal looks native here too.
      '.dc-btn:focus-visible,.dc-mode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.dc-banner{border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1)}',
      '.dc-banner-ok{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-success-primary)}',
      '.dc-banner-bad{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary)}',
      '.dc-ok-hero{border:1px solid var(--dsw-alias-state-success-primary);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:26px 20px;display:flex;align-items:center;gap:14px}',
      // The success circle is a fixed green in both themes, so its glyph is a
      // literal white on purpose rather than a theme-flipping token.
      '.dc-ok-icon{width:40px;height:40px;border-radius:50%;background:var(--dsw-alias-state-success-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}',
      '.dc-ok-title{font-size:17px;font-weight:600;color:var(--dsw-alias-state-success-primary)}',
      '.dc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dc-card-bad{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.dc-card-warn{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
      '.dc-card-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.dc-card-title{font-weight:600;flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dc-dot{width:9px;height:9px;border-radius:50%;flex:none;margin-top:4px}',
      '.dc-dot-fail{background:var(--dsw-alias-state-error-primary)}',
      '.dc-dot-warn{background:var(--dsw-alias-state-warn-primary)}',
      '.dc-dot-ai{background:var(--dsw-alias-brand-primary)}',
      '.dc-chip{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}',
      '.dc-chip-critical{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dc-chip-warning{color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-primary)}',
      '.dc-summary{margin:8px 0 0 19px;color:var(--dsw-alias-label-primary)}',
      '.dc-detail{margin:6px 0 0 19px;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.55;overflow-wrap:anywhere}',
      '.dc-note-line{margin:6px 0 0 19px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dc-card-actions{margin:10px 0 0 19px;display:flex;gap:8px;align-items:center}',
      '.dc-error{color:var(--dsw-alias-state-error-primary);font-size:12.5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px}',
      '.dc-ai-analysis{white-space:pre-wrap;line-height:1.6;margin:2px 0 0 19px;font-size:13px}',
      '.dc-ai-loading{color:var(--dsw-alias-label-secondary);margin:6px 0 0 19px;font-size:12.5px}',
      '.dc-ai-error{color:var(--dsw-alias-state-error-primary);margin:6px 0 0 19px;font-size:12.5px}',
      '.dc-fixbox{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12.5px;display:flex;flex-direction:column;gap:6px}',
      '.dc-fixbox-title{font-weight:600}',
      '.dc-fixbox-line{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.dc-fixbox-fixed{color:var(--dsw-alias-state-success-primary);overflow-wrap:anywhere}',
      '.dc-fixbox-failed{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}',
      '.dc-actions{position:sticky;bottom:14px;display:flex;justify-content:flex-end;gap:8px;padding:10px 4px 2px;margin-top:6px;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}',
      '.dc-env{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}',
      '.dc-loading{color:var(--dsw-alias-label-secondary)}',
    ].join('\n');
    const cssTag = 'dsh-selfrepair/styles';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssTag) + ']') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-selfrepair';
      tag.dataset.pluginCss = cssTag;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    let connectionSvc = null;

    /**
     * Invoke one host `doctor/<method>` Remote endpoint over the connection
     * RPC carrier. Returns the business value; throws on transport or gateway
     * failure (business `{ error }` shapes stay return values).
     */
    const doctorCall = async (t, method, request) => {
      if (connectionSvc === null) throw new Error(t('connectionNotReady'));
      const envelope = await connectionSvc.rpc.call('/api', 'doctor/' + method, {
        args: { request: request === undefined ? null : request },
      });
      if (envelope !== null && typeof envelope === 'object' && envelope.ok === false) {
        const message = envelope.error && envelope.error.message ? envelope.error.message : t('callFailed');
        throw new Error(message);
      }
      if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) return envelope.value;
      throw new Error(t('unexpectedResponse'));
    };

    const errText = (e) => ((e && e.message) ? String(e.message) : String(e));

    /** Render an ISO timestamp in the reader's locale, falling back to the raw value. */
    const whenText = (iso) => {
      if (typeof iso !== 'string' || iso.length === 0) return '';
      try {
        const at = new Date(iso);
        return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
      } catch {
        return iso;
      }
    };

    const DoctorPage = (props) => {
      // The host injects `t` for a slot that declares a locale namespace; the
      // fallback keeps an older host readable rather than blank.
      const t = React.useMemo(() => (typeof props.t === 'function' ? props.t : fallbackT()), [props.t]);

      const [loading, setLoading] = React.useState(true);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [mode, setMode] = React.useState('rules');
      const [aiCap, setAiCap] = React.useState(null);
      const [busy, setBusy] = React.useState(new Set());
      const [confirming, setConfirming] = React.useState(new Set());
      const [writeResult, setWriteResult] = React.useState(null);

      const runStatus = React.useCallback((nextMode) => {
        setError('');
        setLoading(true);
        doctorCall(t, 'status', { mode: nextMode, locale: t('localeCode') }).then((value) => {
          setData(value);
          setLoading(false);
        }, (e) => {
          setError(errText(e));
          setLoading(false);
        });
      }, [t]);

      React.useEffect(() => {
        doctorCall(t, 'info', {}).then((value) => {
          // A successful `info` without an `ai` field means the running host
          // loaded an older build of the plugin (before the AI feature) —
          // only a dsh restart can pick the new host code up.
          const cap = (value && value.ai) || { available: false, reason: t('aiNeedsRestart') };
          setAiCap(cap);
          const initial = cap.available === true ? 'ai' : 'rules';
          setMode(initial);
          runStatus(initial);
        }, (e) => {
          setAiCap({ available: false, reason: errText(e) });
          setMode('rules');
          runStatus('rules');
        });
      }, [runStatus, t]);

      const switchMode = (next) => {
        if (next === mode) return;
        setMode(next);
        runStatus(next);
      };

      /** Run one writing endpoint, then re-read the status it produced. */
      const runWrite = (key, method, request) => {
        setError('');
        setConfirming(new Set());
        setBusy((prev) => new Set(prev).add(key));
        doctorCall(t, method, request).then((value) => {
          setWriteResult({ method, value });
          setBusy(new Set());
          return doctorCall(t, 'status', { mode, locale: t('localeCode') });
        }).then((value) => {
          setData(value);
        }, (e) => {
          setError(errText(e));
          setBusy(new Set());
        });
      };

      const armConfirm = (id) => {
        setConfirming((prev) => {
          const next = new Set(prev);
          next.add(id);
          setTimeout(() => {
            setConfirming((cur) => {
              const after = new Set(cur);
              after.delete(id);
              return after;
            });
          }, 4000);
          return next;
        });
      };

      /** A button that asks for a second click before it writes. */
      const confirmButton = (key, opts) => {
        const isBusy = busy.has(key);
        const isConfirming = confirming.has(key);
        return h('button', {
          key,
          type: 'button',
          className: 'dc-btn' + (isConfirming ? ' dc-btn-danger' : (opts.className || '')),
          disabled: isBusy || opts.disabled === true,
          title: opts.title || '',
          'aria-busy': isBusy ? 'true' : undefined,
          onClick: () => (isConfirming ? opts.onConfirm() : armConfirm(key)),
        }, isBusy ? opts.busyLabel : (isConfirming ? opts.confirmLabel : opts.label));
      };

      const results = data ? data.results : [];
      const broken = results.filter((r) => !r.ok);
      const fixableBroken = broken.filter((r) => r.fixable);
      const env = (data && data.env) || null;
      const ai = (data && data.ai) || null;
      const knownGood = (data && data.knownGood) || null;
      const aiAvailable = ai !== null && ai.available === true;
      const aiUnavailable = ai !== null && ai.available === false;
      const titleOf = (r) => (CHECK_TITLE_KEY[r.id] === undefined ? r.title : t(CHECK_TITLE_KEY[r.id]));

      // Only the checks that found a problem; a healthy install shows the hero.
      const cards = broken.map((r) => {
        const stateCls = r.severity === 'critical' ? 'fail' : 'warn';
        const chipCls = r.severity === 'critical' ? ' dc-chip-critical' : ' dc-chip-warning';
        const actions = [];
        if (r.fixable) {
          actions.push(confirmButton(r.id, {
            label: t('fix'),
            busyLabel: t('fixing'),
            confirmLabel: t('confirmFix'),
            onConfirm: () => runWrite(r.id, 'fix', { only: [r.id] }),
          }));
        }
        return h('div', { key: r.id, className: 'dc-card dc-card-' + stateCls },
          h('div', { className: 'dc-card-head' },
            h('span', { className: 'dc-dot dc-dot-' + stateCls }),
            h('span', { className: 'dc-card-title' }, titleOf(r),
              h('span', { className: 'dc-chip' + chipCls }, t(SEVERITY_KEY[r.severity] || 'severityInfo')))),
          r.summary ? h('div', { className: 'dc-summary' }, r.summary) : null,
          (r.detail && r.detail.length > 0)
            ? h('div', { className: 'dc-detail' }, r.detail.map((d, i) => h('div', { key: i }, d)))
            : null,
          actions.length > 0 ? h('div', { className: 'dc-card-actions' }, actions) : null);
      });

      /** The outcome box for whichever write ran last. */
      const writeRows = (() => {
        if (writeResult === null) return null;
        const value = writeResult.value || {};
        if (writeResult.method === 'fix') {
          const applied = value.applied || [];
          if (applied.length === 0) return h('div', { className: 'dc-fixbox' }, h('div', { className: 'dc-fixbox-line' }, t('nothingToFix')));
          return applied.map((a) => h('div', { key: a.id, className: 'dc-fixbox' },
            h('div', { className: 'dc-fixbox-title' }, CHECK_TITLE_KEY[a.id] === undefined ? a.title : t(CHECK_TITLE_KEY[a.id])),
            (a.fixed || []).map((f, i) => h('div', { key: 'f' + i, className: 'dc-fixbox-fixed' }, '✓ ' + f)),
            (a.failed || []).map((f, i) => h('div', { key: 'e' + i, className: 'dc-fixbox-failed' }, '✗ ' + f.name + ': ' + f.error)),
            a.note ? h('div', { className: 'dc-fixbox-line' }, a.note.split('\n').map((l, i) => h('div', { key: 'n' + i }, l))) : null));
        }
        if (writeResult.method === 'restore') {
          const undone = value.undone || [];
          if (undone.length === 0) return h('div', { className: 'dc-fixbox' }, h('div', { className: 'dc-fixbox-line' }, t('nothingToRestore')));
          return undone.map((u) => h('div', { key: u.id, className: 'dc-fixbox' },
            h('div', { className: 'dc-fixbox-title' }, CHECK_TITLE_KEY[u.id] === undefined ? u.title : t(CHECK_TITLE_KEY[u.id])),
            (u.restored || []).map((r, i) => h('div', { key: 'r' + i, className: 'dc-fixbox-fixed' }, '✓ ' + r)),
            (u.failed || []).map((f, i) => h('div', { key: 'e' + i, className: 'dc-fixbox-failed' }, '✗ ' + f.name + ': ' + f.error)),
            u.note ? h('div', { className: 'dc-fixbox-line' }, u.note.split('\n').map((l, i) => h('div', { key: 'n' + i }, l))) : null));
        }
        const rolled = value.rolledBack || {};
        if (!rolled.from) return h('div', { className: 'dc-fixbox' }, h('div', { className: 'dc-fixbox-line' }, t('nothingToRollback')));
        return h('div', { className: 'dc-fixbox' },
          h('div', { className: 'dc-fixbox-title' }, t('rolledBackTo', { at: whenText(rolled.recordedAt) })),
          (rolled.restored || []).map((r, i) => h('div', { key: 'r' + i, className: 'dc-fixbox-fixed' }, '✓ ' + r)),
          (rolled.failed || []).map((f, i) => h('div', { key: 'e' + i, className: 'dc-fixbox-failed' }, '✗ ' + f.name + ': ' + f.error)),
          (rolled.restored || []).indexOf('settings.yaml') >= 0
            ? h('div', { className: 'dc-fixbox-line' }, t('sharedSettings')) : null,
          h('div', { className: 'dc-fixbox-line' }, t('restartHint')));
      })();

      const aiUnavailableNote = (aiUnavailable && data && data.mode === 'ai')
        ? h('div', { className: 'dc-note-line' }, t('aiUnavailable', { reason: ai.reason || t('aiUnknownReason') }))
        : null;

      const aiCard = (mode === 'ai' && aiAvailable)
        ? h('div', { key: 'ai', className: 'dc-card' },
            h('div', { className: 'dc-card-head' },
              h('span', { className: 'dc-dot dc-dot-ai' }),
              h('span', { className: 'dc-card-title' }, t('aiTitle'), h('span', { className: 'dc-chip' }, ai.model || t('aiModelFallback'))),
              h('span', { className: 'dc-hint' }, t('aiHint'))),
            loading ? h('div', { className: 'dc-ai-loading' }, t('aiRunning'))
              : (ai.error ? h('div', { className: 'dc-ai-error' }, t('aiFailed', { error: ai.error }))
                : h('div', { className: 'dc-ai-analysis' }, ai.analysis || '')))
        : null;

      return h('div', { className: 'dc-page' },
        h('div', { className: 'dc-head' },
          h('div', { className: 'dc-title' }, t('tab'), h('span', { className: 'dc-hint' }, t('subtitle'))),
          h('div', { className: 'dc-modes', role: 'group' },
            h('button', {
              type: 'button',
              className: 'dc-mode' + (mode === 'ai' ? ' dc-mode-active' : ''),
              'aria-pressed': mode === 'ai' ? 'true' : 'false',
              disabled: loading || aiCap === null || aiCap.available !== true,
              title: (aiCap !== null && aiCap.available === false) ? aiCap.reason : '',
              onClick: () => switchMode('ai'),
            }, t('modeAi')),
            h('button', {
              type: 'button',
              className: 'dc-mode' + (mode === 'rules' ? ' dc-mode-active' : ''),
              'aria-pressed': mode === 'rules' ? 'true' : 'false',
              disabled: loading,
              onClick: () => switchMode('rules'),
            }, t('modeRules')))),
        error ? h('div', { className: 'dc-error', role: 'alert' }, error) : null,
        h('div', { 'aria-live': 'polite' },
          data && data.healthy ? h('div', { className: 'dc-ok-hero' },
            h('div', { className: 'dc-ok-icon' }, '✓'),
            h('div', {},
              h('div', { className: 'dc-ok-title' }, t('allClear')),
              h('div', { className: 'dc-hint' },
                t(mode === 'ai' && aiAvailable ? 'allClearHintAi' : 'allClearHint', { count: results.length })))) : null,
          data && !data.healthy ? h('div', { className: 'dc-banner dc-banner-bad' },
            fixableBroken.length > 0
              ? t('problemsFixable', { count: broken.length, fixable: fixableBroken.length })
              : t('problems', { count: broken.length })) : null,
          (!data && loading) ? h('div', { className: 'dc-loading' }, t('loading')) : null),
        cards,
        aiUnavailableNote,
        aiCard,
        writeRows,
        h('div', { className: 'dc-actions' },
          h('span', { className: 'dc-hint', style: { marginRight: 'auto' } },
            knownGood && knownGood.recordedAt
              ? t('knownGoodAt', { at: whenText(knownGood.recordedAt) })
              : t('knownGoodNone')),
          confirmButton('__rollback__', {
            label: t('rollback'),
            busyLabel: t('rollingBack'),
            confirmLabel: t('confirmRollback'),
            disabled: !(knownGood && knownGood.recordedAt),
            title: knownGood && knownGood.recordedAt ? '' : t('knownGoodNone'),
            onConfirm: () => runWrite('__rollback__', 'rollback', {}),
          }),
          confirmButton('__restore__', {
            label: t('restore'),
            busyLabel: t('restoring'),
            confirmLabel: t('confirmRestore'),
            onConfirm: () => runWrite('__restore__', 'restore', {}),
          }),
          fixableBroken.length > 0
            ? confirmButton('__all__', {
              className: ' dc-btn-primary',
              label: t('fixAll', { count: fixableBroken.length }),
              busyLabel: t('fixing'),
              confirmLabel: t('confirmFix'),
              onConfirm: () => runWrite('__all__', 'fix', {}),
            })
            : null,
          h('button', {
            type: 'button',
            className: 'dc-btn',
            disabled: loading,
            'aria-busy': loading ? 'true' : undefined,
            onClick: () => runStatus(mode),
          }, loading ? t('rechecking') : t('recheck'))),
        env ? h('div', { className: 'dc-env' },
          h('div', {}, 'profile: ' + env.profileRoot),
          h('div', {}, 'global : ' + env.globalRoot),
          h('div', {}, 'dshHome: ' + env.dshHome)) : null);
    };

    const inject = ['connection', 'slots', 'locale'];

    function apply(c) {
      connectionSvc = c.get('connection');
      const slots = c.get('slots');
      if (slots === undefined) return;
      const locale = c.get('locale');
      // Register the dictionaries before the section, so the tab label can
      // resolve on first paint.
      if (locale !== undefined && typeof locale.register === 'function') {
        c.effect(() => locale.register(NS, { zh, en }), 'doctor: dictionaries');
      }
      const bound = (locale !== undefined && typeof locale.bind === 'function') ? locale.bind(NS) : null;
      const label = bound === null ? fallbackT() : bound;
      c.effect(() => slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'doctor', order: 30, label: () => label('tab'), locale: NS },
        (props) => h(DoctorPage, { close: props.close, t: props.t === undefined ? bound : props.t }),
      )), 'doctor: settings section');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.NS = NS;
    // Exported for the bundle test: dictionary parity is the only way to catch
    // a key that was translated in one language and forgotten in the other.
    exports.locales = { zh, en };
    exports.checkTitleKeys = CHECK_TITLE_KEY;
    return module.exports;
  },
});
