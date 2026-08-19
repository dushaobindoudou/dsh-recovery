/**
 * dsh-selfrepair - client half (web).
 *
 * Registers the "诊断" settings page (settings.section). Talks to the host
 * `doctor` Remote namespace through the connection RPC carrier, so the page
 * and the terminal run the exact same diagnosis.
 *
 * Behavior contract with the user:
 *  - Only the checks that found a problem are listed; a healthy install shows
 *    a single "一切正常" hero and nothing else.
 *  - 重新检查 and 一键修复 live in a bottom-right action bar that stays fixed
 *    (sticky) while the page content scrolls.
 *  - Two detection modes: AI 检测 (host runs the rule checks AND asks the
 *    default model for a second opinion) and 规则检测 (rules only). AI is the
 *    default when the host reports it available, rules otherwise.
 *  - Opening the page never writes. Fixes are explicit: per-check buttons
 *    double-confirm; 一键修复 is one deliberate click, and every fix backs up.
 */
window.__ModuleLoader__.load({
  id: 'dsh-selfrepair',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const react = require('react');
    const React = react;
    const h = React.createElement;

    const CSS = [
      '.dc-page{font-size:13.5px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px;max-width:720px}',
      '.dc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dc-title{font-size:16px;font-weight:600;margin-right:auto;display:flex;align-items:center;gap:8px}',
      '.dc-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dc-modes{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dc-mode{border:none;background:transparent;color:var(--dsw-alias-label-secondary);height:26px;padding:0 12px;border-radius:8px;cursor:pointer;font-size:12.5px;white-space:nowrap}',
      '.dc-mode:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dc-mode-active{background:var(--dsw-alias-brand-primary);color:#fff}',
      // Specificity must beat `.dc-mode:hover:not(:disabled)` above, or the
      // active chip's label turns dark on its brand-colored background.
      '.dc-mode.dc-mode-active:hover{color:#fff}',
      '.dc-mode:disabled{opacity:.45;cursor:not-allowed}',
      '.dc-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;white-space:nowrap}',
      '.dc-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
      '.dc-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.dc-btn:disabled{opacity:.5;cursor:default}',
      '.dc-banner{border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1)}',
      '.dc-banner-ok{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-success-primary)}',
      '.dc-banner-bad{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary)}',
      '.dc-ok-hero{border:1px solid var(--dsw-alias-state-success-primary);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:26px 20px;display:flex;align-items:center;gap:14px}',
      '.dc-ok-icon{width:40px;height:40px;border-radius:50%;background:var(--dsw-alias-state-success-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}',
      '.dc-ok-title{font-size:17px;font-weight:600;color:var(--dsw-alias-state-success-primary)}',
      '.dc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dc-card-bad{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.dc-card-warn{border-left:3px solid var(--dsw-alias-state-warning-primary)}',
      '.dc-card-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.dc-card-title{font-weight:600;flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dc-dot{width:9px;height:9px;border-radius:50%;flex:none;margin-top:4px}',
      '.dc-dot-fail{background:var(--dsw-alias-state-error-primary)}',
      '.dc-dot-warn{background:var(--dsw-alias-state-warning-primary)}',
      '.dc-dot-ai{background:var(--dsw-alias-brand-primary)}',
      '.dc-chip{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}',
      '.dc-chip-critical{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dc-summary{margin:8px 0 0 19px;color:var(--dsw-alias-label-primary)}',
      '.dc-detail{margin:6px 0 0 19px;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.55}',
      '.dc-note-line{margin:6px 0 0 19px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dc-card-actions{margin:10px 0 0 19px;display:flex;gap:8px;align-items:center}',
      '.dc-error{color:var(--dsw-alias-state-error-primary);font-size:12.5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px}',
      '.dc-ai-analysis{white-space:pre-wrap;line-height:1.6;margin:2px 0 0 19px;font-size:13px}',
      '.dc-ai-loading{color:var(--dsw-alias-label-secondary);margin:6px 0 0 19px;font-size:12.5px}',
      '.dc-ai-error{color:var(--dsw-alias-state-error-primary);margin:6px 0 0 19px;font-size:12.5px}',
      '.dc-fixbox{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12.5px;display:flex;flex-direction:column;gap:6px}',
      '.dc-fixbox-title{font-weight:600}',
      '.dc-fixbox-line{color:var(--dsw-alias-label-secondary)}',
      '.dc-fixbox-fixed{color:var(--dsw-alias-state-success-primary)}',
      '.dc-fixbox-failed{color:var(--dsw-alias-state-error-primary)}',
      '.dc-actions{position:sticky;bottom:14px;display:flex;justify-content:flex-end;gap:8px;padding:10px 4px 2px;margin-top:6px;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dc-env{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px}',
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
    const doctorCall = async (method, request) => {
      if (connectionSvc === null) throw new Error('连接服务尚未就绪');
      const envelope = await connectionSvc.rpc.call('/api', 'doctor/' + method, {
        args: { request: request === undefined ? null : request },
      });
      if (envelope !== null && typeof envelope === 'object' && envelope.ok === false) {
        const message = envelope.error && envelope.error.message ? envelope.error.message : '调用失败';
        throw new Error(message);
      }
      if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) return envelope.value;
      throw new Error('意外的 RPC 响应');
    };

    const errText = (e) => (e && e.message) ? String(e.message) : String(e);
    const SEV_TEXT = { critical: '关键', warning: '警告', info: '信息' };

    const DoctorPage = (props) => {
      const [loading, setLoading] = React.useState(true);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [mode, setMode] = React.useState('rules');
      const [aiCap, setAiCap] = React.useState(null);
      const [fixing, setFixing] = React.useState(new Set());
      const [confirming, setConfirming] = React.useState(new Set());
      const [fixResult, setFixResult] = React.useState(null);

      const runStatus = React.useCallback((nextMode) => {
        setError('');
        setLoading(true);
        doctorCall('status', { mode: nextMode }).then((value) => {
          setData(value);
          setLoading(false);
        }, (e) => {
          setError(errText(e));
          setLoading(false);
        });
      }, []);

      React.useEffect(() => {
        doctorCall('info', {}).then((value) => {
          // A successful `info` without an `ai` field means the running host
          // loaded an older build of the plugin (before the AI feature) —
          // only a dsh restart can pick the new host code up.
          const cap = (value && value.ai) || { available: false, reason: 'AI 检测需要重启 dsh web 后生效：当前进程加载的是旧版插件宿主代码' };
          setAiCap(cap);
          const initial = cap.available === true ? 'ai' : 'rules';
          setMode(initial);
          runStatus(initial);
        }, (e) => {
          setAiCap({ available: false, reason: errText(e) });
          setMode('rules');
          runStatus('rules');
        });
      }, [runStatus]);

      const switchMode = (next) => {
        if (next === mode) return;
        setMode(next);
        runStatus(next);
      };

      const runFix = (only) => {
        setError('');
        setConfirming(new Set());
        setFixing((prev) => {
          const next = new Set(prev);
          next.add(only === null ? '__all__' : only);
          return next;
        });
        const request = only === null ? {} : { only: [only] };
        doctorCall('fix', request).then((value) => {
          setFixResult(value);
          setFixing(new Set());
          return doctorCall('status', { mode });
        }).then((value) => {
          setData(value);
        }, (e) => {
          setError(errText(e));
          setFixing(new Set());
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

      const results = data ? data.results : [];
      const broken = results.filter((r) => !r.ok);
      const fixableBroken = broken.filter((r) => r.fixable);
      const env = (data && data.env) || null;
      const ai = (data && data.ai) || null;
      const aiAvailable = ai !== null && ai.available === true;
      const aiUnavailable = ai !== null && ai.available === false;

      // Point 6: only the checks that found a problem; healthy shows the hero.
      const cards = broken.map((r) => {
        const stateCls = r.severity === 'critical' ? 'fail' : 'warn';
        const chipCls = r.severity === 'critical' ? ' dc-chip-critical' : '';
        const actions = [];
        if (r.fixable) {
          const isFixing = fixing.has(r.id);
          const isConfirming = confirming.has(r.id);
          actions.push(h('button', {
            key: 'fix',
            type: 'button',
            className: 'dc-btn' + (isConfirming ? ' dc-btn-danger' : ''),
            disabled: isFixing,
            onClick: () => (isConfirming ? runFix(r.id) : armConfirm(r.id)),
          }, isFixing ? '修复中…' : isConfirming ? '再次点击确认修复' : '修复'));
        }
        return h('div', { key: r.id, className: 'dc-card dc-card-' + stateCls },
          h('div', { className: 'dc-card-head' },
            h('span', { className: 'dc-dot dc-dot-' + stateCls }),
            h('span', { className: 'dc-card-title' }, r.title, h('span', { className: 'dc-chip' + chipCls }, SEV_TEXT[r.severity] || r.severity))),
          r.summary ? h('div', { className: 'dc-summary' }, r.summary) : null,
          (r.detail && r.detail.length > 0) ? h('div', { className: 'dc-detail' }, r.detail.map((d, i) => h('div', { key: i }, d))) : null,
          actions.length > 0 ? h('div', { className: 'dc-card-actions' }, actions) : null);
      });

      const fixRows = fixResult ? fixResult.applied.map((a) => h('div', { key: a.id, className: 'dc-fixbox' },
        h('div', { className: 'dc-fixbox-title' }, a.title),
        a.fixed.map((f, i) => h('div', { key: 'f' + i, className: 'dc-fixbox-fixed' }, '✓ ' + f)),
        a.failed.map((f, i) => h('div', { key: 'e' + i, className: 'dc-fixbox-failed' }, '✗ ' + f.name + ': ' + f.error)),
        a.note ? h('div', { className: 'dc-fixbox-line' }, a.note.split('\n').map((l, i) => h('div', { key: 'n' + i }, l))) : null)) : null;

      const aiUnavailableNote = (aiUnavailable && data && data.mode === 'ai')
        ? h('div', { className: 'dc-note-line' }, 'AI 不可用（' + (ai.reason || '未知原因') + '），已使用规则检测')
        : null;

      const aiCard = (mode === 'ai' && aiAvailable)
        ? h('div', { key: 'ai', className: 'dc-card' },
            h('div', { className: 'dc-card-head' },
              h('span', { className: 'dc-dot dc-dot-ai' }),
              h('span', { className: 'dc-card-title' }, 'AI 分析', h('span', { className: 'dc-chip' }, (ai.model || '模型'))),
              h('span', { className: 'dc-hint' }, '规则检查之外的模型第二意见')),
            loading ? h('div', { className: 'dc-ai-loading' }, 'AI 分析中…')
              : (ai.error ? h('div', { className: 'dc-ai-error' }, 'AI 分析失败：' + ai.error)
                : h('div', { className: 'dc-ai-analysis' }, ai.analysis || '')))
        : null;

      return h('div', { className: 'dc-page' },
        h('div', { className: 'dc-head' },
          h('div', { className: 'dc-title' }, '诊断', h('span', { className: 'dc-hint' }, 'Doctor')),
          h('div', { className: 'dc-modes' },
            h('button', {
              type: 'button',
              className: 'dc-mode' + (mode === 'ai' ? ' dc-mode-active' : ''),
              disabled: loading || aiCap === null || aiCap.available !== true,
              title: (aiCap !== null && aiCap.available === false) ? aiCap.reason : '',
              onClick: () => switchMode('ai'),
            }, 'AI 检测'),
            h('button', {
              type: 'button',
              className: 'dc-mode' + (mode === 'rules' ? ' dc-mode-active' : ''),
              disabled: loading,
              onClick: () => switchMode('rules'),
            }, '规则检测'))),
        error ? h('div', { className: 'dc-error' }, error) : null,
        data && data.healthy ? h('div', { className: 'dc-ok-hero' },
          h('div', { className: 'dc-ok-icon' }, '✓'),
          h('div', {},
            h('div', { className: 'dc-ok-title' }, '一切正常'),
            h('div', { className: 'dc-hint' }, results.length + ' 项检查全部通过' + (mode === 'ai' && aiAvailable ? '，AI 分析见下' : '')))) : null,
        data && !data.healthy ? h('div', { className: 'dc-banner dc-banner-bad' },
          '发现 ' + broken.length + ' 个问题' + (fixableBroken.length > 0 ? '，其中 ' + fixableBroken.length + ' 个可一键修复' : '')) : null,
        (!data && loading) ? h('div', { className: 'dc-loading' }, '正在运行诊断…') : null,
        cards,
        aiUnavailableNote,
        aiCard,
        fixRows,
        h('div', { className: 'dc-actions' },
          fixableBroken.length > 0 ? h('button', {
            type: 'button',
            className: 'dc-btn dc-btn-danger',
            disabled: fixing.has('__all__'),
            onClick: () => runFix(null),
          }, fixing.has('__all__') ? '修复中…' : '一键修复 (' + fixableBroken.length + ')') : null,
          h('button', { type: 'button', className: 'dc-btn', disabled: loading, onClick: () => runStatus(mode) },
            loading ? '诊断中…' : '重新检查')),
        env ? h('div', { className: 'dc-env' },
          h('div', {}, 'profile: ' + env.profileRoot),
          h('div', {}, 'global : ' + env.globalRoot),
          h('div', {}, 'dshHome: ' + env.dshHome)) : null);
    };

    const inject = ['connection', 'slots'];

    function apply(c) {
      connectionSvc = c.get('connection');
      const slots = c.get('slots');
      if (slots === undefined) return;
      c.effect(() => slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'doctor', order: 30, label: '诊断' },
        (props) => h(DoctorPage, { close: props.close }),
      )), 'doctor: settings section');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
