export const PLAYER_CSS = `
.chronos{--c-bg:#ffffff;--c-panel:#f5f6f8;--c-border:#dfe2e7;--c-text:#1d2330;--c-muted:#5f6878;--c-accent:#3f6ee8;--c-error:#d23b3b;--c-warn:#b7791f;--c-stage:#e9ecf1;
  display:flex;gap:0;width:100%;height:100%;min-height:320px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--c-text);background:var(--c-bg);border:1px solid var(--c-border);border-radius:10px;overflow:hidden;box-sizing:border-box}
.chronos *{box-sizing:border-box}
.chronos label,.chronos input,.chronos select,.chronos button{font:inherit;letter-spacing:normal;text-transform:none}
.chronos input[type=checkbox]{appearance:auto;width:auto;height:auto;margin:0;padding:0;border:0;outline-offset:2px;accent-color:var(--c-accent)}
.chronos ol,.chronos li{margin:0}
@media (prefers-color-scheme:dark){.chronos:not([data-theme=light]){--c-bg:#16191f;--c-panel:#1d2129;--c-border:#2c323d;--c-text:#e6e9ef;--c-muted:#97a0b0;--c-accent:#7c9cff;--c-error:#ff6b6b;--c-warn:#f0b35a;--c-stage:#0f1115}}
.chronos[data-theme=dark]{--c-bg:#16191f;--c-panel:#1d2129;--c-border:#2c323d;--c-text:#e6e9ef;--c-muted:#97a0b0;--c-accent:#7c9cff;--c-error:#ff6b6b;--c-warn:#f0b35a;--c-stage:#0f1115}
.chronos-main{flex:1;min-width:0;display:flex;flex-direction:column}
.chronos-stage{position:relative;flex:1;min-height:200px;overflow:hidden;background:var(--c-stage)}
.chronos-frame{position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;box-shadow:0 2px 18px rgba(0,0,0,.18);overflow:hidden}
.chronos-frame iframe{display:block;border:0;width:100%;height:100%;pointer-events:none;background:#fff}
.chronos-cursor{position:absolute;left:0;top:0;width:22px;height:22px;pointer-events:none;transform-origin:0 0;will-change:transform;z-index:3;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.chronos-ripple{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid var(--c-accent);pointer-events:none;opacity:0;z-index:2}
.chronos-banner{position:absolute;left:12px;right:12px;bottom:12px;display:none;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:var(--c-error);color:#fff;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:4;word-break:break-word}
.chronos-banner[data-show]{display:flex}
.chronos-controls{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--c-border);background:var(--c-panel)}
.chronos-btn{appearance:none;border:1px solid var(--c-border);background:var(--c-bg);color:var(--c-text);border-radius:6px;min-width:36px;height:32px;padding:0 10px;cursor:pointer;font:inherit;display:inline-flex;align-items:center;justify-content:center}
.chronos-btn:hover{border-color:var(--c-accent)}
.chronos-btn:focus-visible,.chronos-track:focus-visible,.chronos-actions li:focus-visible{outline:2px solid var(--c-accent);outline-offset:2px}
.chronos-time{font-variant-numeric:tabular-nums;color:var(--c-muted);white-space:nowrap;min-width:84px}
.chronos-track{position:relative;flex:1;height:28px;cursor:pointer;touch-action:none}
.chronos-track::before{content:"";position:absolute;left:0;right:0;top:12px;height:4px;border-radius:2px;background:var(--c-border)}
.chronos-fill{position:absolute;left:0;top:12px;height:4px;border-radius:2px;background:var(--c-accent)}
.chronos-thumb{position:absolute;top:7px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--c-accent);box-shadow:0 0 0 3px var(--c-bg)}
.chronos-mark{position:absolute;top:6px;width:2px;height:16px;margin-left:-1px;background:var(--c-muted);opacity:.55;border-radius:1px}
.chronos-mark[data-kind=error]{background:var(--c-error);opacity:1;width:3px}
.chronos-mark[data-kind=page],.chronos-mark[data-kind=nav]{background:var(--c-accent);opacity:.9}
.chronos-select{height:32px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);color:var(--c-text);font:inherit;padding:0 6px}
.chronos-toggle{display:flex;flex-direction:row;gap:6px;align-items:center;color:var(--c-muted);white-space:nowrap;cursor:pointer;font-weight:400}
.chronos-actions{width:300px;flex-shrink:0;border-left:1px solid var(--c-border);background:var(--c-panel);display:flex;flex-direction:column;min-height:0}
.chronos-actions header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--c-border);font-weight:600}
.chronos-actions ol{list-style:none;margin:0;padding:4px 0;overflow-y:auto;flex:1}
.chronos-actions li{display:grid;grid-template-columns:42px 1fr;gap:6px;padding:6px 12px;cursor:pointer;border-left:3px solid transparent}
.chronos-actions li:hover{background:color-mix(in srgb,var(--c-accent) 8%,transparent)}
.chronos-actions li[data-current]{background:color-mix(in srgb,var(--c-accent) 16%,transparent);border-left-color:var(--c-accent)}
.chronos-actions li[data-future]{opacity:.5}
.chronos-actions li[data-severity=error] .chronos-label{color:var(--c-error);font-weight:600}
.chronos-actions li[data-severity=warning] .chronos-label{color:var(--c-warn)}
.chronos-actions .chronos-at{color:var(--c-muted);font-variant-numeric:tabular-nums}
.chronos-actions .chronos-detail{grid-column:2;color:var(--c-muted);font-size:12px;white-space:pre-wrap;max-height:4.2em;overflow:hidden}
.chronos-actions li[data-kind=http][data-severity=info]{display:none}
.chronos[data-network] .chronos-actions li[data-kind=http][data-severity=info]{display:grid}
@media (max-width:760px){.chronos{flex-direction:column}.chronos-actions{width:auto;border-left:0;border-top:1px solid var(--c-border);max-height:40%}.chronos-toggle span{display:none}}
`;
export const CURSOR_SVG = `<svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><path d="M3 2 L3 18 L7.2 14.1 L10 20.2 L12.9 18.9 L10.2 12.9 L16 12.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
//# sourceMappingURL=styles.js.map