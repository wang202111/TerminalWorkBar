'use strict';
(() => {
  const frame = document.getElementById('product-frame');
  let ready = false;
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layout = 'workspace';
  let completed = false;
  function send(action, extra = {}) {
    if (ready) frame.contentWindow.postMessage({ channel: 'terminal-demo-control', action, ...extra }, '*');
  }
  function updatePlaying(value) {
    playing = value;
    document.getElementById('toggle-play').textContent = playing ? 'Ⅱ 暂停，自己试' : completed ? '↻ 重播演示' : '▶ 继续演示';
    document.getElementById('demo-window').dataset.playing = String(playing);
  }
  function chooseLayout(value) {
    const startPlaying = playing || completed;
    completed = false;
    layout = value;
    document.getElementById('demo-window').dataset.layout = layout;
    document.querySelectorAll('[data-window]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.window === layout)));
    document.getElementById('window-title').textContent = { workspace: 'iTerm2 风格演示外框 · 右侧为真实 Sidebar 前端', editor: 'Terminal Sidebar · 原版终端入口编辑窗口', markdown: 'Terminal Sidebar · 原版 Markdown 导出窗口' }[layout];
    send('layout', { layout, playing: startPlaying });
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.data?.channel !== 'terminal-demo-event') return;
    const data = event.data;
    if (data.type === 'ready') { ready = true; send('speed', { speed: Number(document.getElementById('demo-speed').value) }); chooseLayout(layout); updatePlaying(playing); }
    if (data.type === 'status') { document.getElementById('step-title').textContent = data.title; document.getElementById('step-description').textContent = data.description; }
    if (data.type === 'playing') { completed = Boolean(data.completed); updatePlaying(Boolean(data.playing)); }
    if (data.type === 'terminal') { document.getElementById('terminal-tab').textContent = data.id + ' — 输出模拟'; document.getElementById('terminal-output').textContent = data.output; document.getElementById('run-state').textContent = data.count + ' 个模拟运行入口'; }
    if (data.type === 'reset') { document.getElementById('run-state').textContent = '0 个模拟运行入口'; document.getElementById('terminal-output').textContent = '$ demo workspace\n\n演示数据已重置。\n右侧原版界面可直接操作。\n▍'; }
    if (data.type === 'error') { const error = document.getElementById('demo-error'); error.hidden = false; error.textContent = data.message; }
  });
  document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => chooseLayout(button.dataset.window)));
  document.getElementById('toggle-play').addEventListener('click', () => { updatePlaying(!playing); send('play', { playing }); });
  document.getElementById('demo-speed').addEventListener('change', event => send('speed', { speed: Number(event.target.value) }));
  document.getElementById('reset-demo').addEventListener('click', () => send('reset', { layout, playing }));
  let resume = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { resume = playing; send('play', { playing: false }); }
    else if (resume) { resume = false; updatePlaying(true); send('play', { playing: true }); }
  });
  updatePlaying(playing);
  if (typeof window.PRODUCT_DEMO_HTML !== 'string') {
    document.getElementById('demo-error').hidden = false;
    document.getElementById('demo-error').textContent = '缺少生成的产品前端资源，请打开完整的网站发行目录。';
  } else frame.srcdoc = window.PRODUCT_DEMO_HTML;
})();
