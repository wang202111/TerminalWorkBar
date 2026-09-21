(() => {
  const backend = window.DEMO_BACKEND;
  let playing = false;
  let speed = 1.5;
  let layout = 'workspace';
  let step = 0;
  let waiting = 0;
  let lastFrame = 0;
  let frame;
  let busy = false;
  let typing = null;
  let motion = null;
  let generation = 0;
  let ready = false;
  let manualOverride = false;
  let completed = false;
  let cursor;
  const emit = backend.emit;
  const sequences = {
    workspace: [
      ['#expand-all', '展开真实任务树', '下面的按钮、卡片和记录都是原版前端。', 650],
      ['[data-node-id="demo-review"] .open-terminal', '第一次打开入口', '点击原版按钮，演示后端只发送文字输出。', 1000],
      ['[data-node-id="demo-review"] .open-terminal', '再点一次：直接复用', '不重跑命令，不重新 SSH。', 1000],
      ['#new-task', '添加演示任务', '使用真实任务表单。', 550],
      ['#task-form [name="title"]', '输入任务名称', '演示输入，不读取剪贴板。', 850, '整理发布结论'],
      ['#task-form [name="parent_id"]', '选择所属项目', '层级关联由原版 UI 处理。', 450, 'demo-project'],
      ['#task-form [name="command_id"]', '选择终端入口', '本级关联已有的远端工作区。', 450, 'demo-ssh'],
      ['#task-form [type="submit"]', '保存完成', '数据只写在页面内存，真实任务不变。', 1100],
    ],
    editor: [
      ['#new-command', '打开原版入口编辑器', '这是应用中的同一份表单，不是重新画的示意图。', 600],
      ['#command-form [name="title"]', '填写入口名称', '先配置，稍后才打开。', 700, 'Demo 开发终端'],
      ['#ssh-host-select', '选择演示 SSH 别名', '这里只提供虚构别名，不读你的 config。', 500, 'demo-dev'],
      ['#list-tmux', '查询演示 tmux', '真实查询按钮，虚构结果。没有网络连接。', 750],
      ['#sessions button', '选择 workspace 会话', '可以亲手操作其他字段。', 550],
      ['#command-form [name="window"]', '细化到 tmux window', '演示窗口名称：build。', 650, 'build'],
      ['#command-form [type="submit"]', '保存，不执行', '入口出现在原版终端列表里。', 1200],
    ],
    markdown: [
      ['#export', '打开原版导出预览', '真实导出对话框；数据来自本页演示库。', 1100],
      ['#export-format', '切换可回导格式', '保留节点 ID，页面展示原版说明。', 1200, 'roundtrip'],
      ['#export-dialog details summary', '展开 Markdown 源码', '可直接观察阅读版与回导版差别。', 1300],
      ['#export-format', '再看清爽阅读版', '完整的回导行为请在真实应用使用。', 1100, 'pretty'],
    ],
  };
  function status(title, description) { emit('status', { title, description }); }
  function setPlaying(value) {
    if (value && (manualOverride || completed)) {
      manualOverride = false;
      reset();
    }
    playing = value;
    cursor.hidden = !playing;
    emit('playing', { playing, completed });
    cancelAnimationFrame(frame);
    lastFrame = 0;
    if (playing) frame = requestAnimationFrame(tick);
  }
  async function reset() {
    const epoch = ++generation;
    completed = false;
    manualOverride = false;
    busy = true;
    typing = null;
    motion = null;
    step = 0;
    waiting = 100;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    backend.reset();
    branches.clear();
    expanded.clear();
    drafts.clear();
    document.getElementById('search').value = '';
    document.getElementById('filter').value = 'active';
    switchTab('tasks');
    await refresh();
    if (epoch === generation) { busy = false; status('演示已就绪', '点“暂停，自己试”即可操作这些真实控件。'); }
  }
  function revealControl(target) {
    for (let container = target.parentElement; container; container = container.parentElement) {
      const root = container === document.scrollingElement;
      if (!root && !/(auto|scroll)/.test(getComputedStyle(container).overflowY)) continue;
      const bounds = container.getBoundingClientRect();
      const top = root ? 0 : bounds.top + container.clientTop;
      const bottom = root ? innerHeight : top + container.clientHeight;
      const rectangle = target.getBoundingClientRect();
      if (rectangle.bottom > bottom) container.scrollTop += rectangle.bottom - bottom + 8;
      else if (rectangle.top < top) container.scrollTop -= top - rectangle.top + 8;
    }
  }
  async function nextStep() {
    if (step >= sequences[layout].length) {
      completed = true;
      setPlaying(false);
      status('本段演示完成', '结果已保留，可以直接操作；点“重播演示”才会重新开始。');
      return;
    }
    const [selector, title, description, hold, value] = sequences[layout][step++];
    const target = document.querySelector(selector);
    if (!target || !target.getClientRects().length) throw new Error('未找到演示控件：' + selector);
    revealControl(target);
    status(title, description);
    const rectangle = target.getBoundingClientRect();
    const topLayer = target.closest('dialog');
    (topLayer || document.body).append(cursor);
    const parent = topLayer?.getBoundingClientRect() || { left: 0, top: 0 };
    const destination = { x: rectangle.left + Math.min(rectangle.width * .7, 140) - parent.left, y: rectangle.top + rectangle.height * .65 - parent.top };
    motion = { elapsed: 0, destination, target, value, hold };
  }
  function perform(action) {
    const { target, value, hold } = action;
    target.classList.add('demo-hit');
    document.querySelectorAll('.demo-hit').forEach(node => { if (node !== target) node.classList.remove('demo-hit'); });
    if (value !== undefined && target.tagName !== 'SELECT') {
      target.focus({ preventScroll: true });
      target.value = '';
      typing = { target, text: value, elapsed: 0, duration: 430, hold };
    } else {
      if (value !== undefined) { target.value = value; target.dispatchEvent(new Event('change', { bubbles: true })); }
      else target.click();
      waiting = hold;
    }
  }
  function tick(timestamp) {
    if (!playing) return;
    const delta = lastFrame ? Math.min(80, timestamp - lastFrame) * speed : 0;
    lastFrame = timestamp;
    if (!busy) {
      if (motion) {
        motion.elapsed += delta;
        const progress = Math.min(1, motion.elapsed / 180);
        cursor.style.left = motion.destination.x + (1 - progress) * 25 + 'px';
        cursor.style.top = motion.destination.y + (1 - progress) * 15 + 'px';
        if (progress === 1) { const action = motion; motion = null; perform(action); }
      } else if (typing) {
        typing.elapsed += delta;
        typing.target.value = typing.text.slice(0, Math.ceil(typing.text.length * Math.min(1, typing.elapsed / typing.duration)));
        typing.target.dispatchEvent(new Event('input', { bubbles: true }));
        if (typing.elapsed >= typing.duration) { waiting = typing.hold; typing = null; }
      } else {
        waiting -= delta;
        if (waiting <= 0) { busy = true; nextStep().then(() => { busy = false; }).catch(error => { busy = false; setPlaying(false); emit('error', { message: '演示已暂停：' + error.message }); }); }
      }
    }
    if (playing) frame = requestAnimationFrame(tick);
  }
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.channel !== 'terminal-demo-control' || !ready) return;
    const data = event.data;
    if (data.action === 'speed' && [1, 1.5, 2].includes(data.speed)) speed = data.speed;
    if (data.action === 'play') setPlaying(Boolean(data.playing));
    if (['layout', 'reset'].includes(data.action) && Object.hasOwn(sequences, data.layout)) {
      setPlaying(false);
      layout = data.layout;
      await reset();
      if (!data.playing) {
        if (layout === 'editor') document.getElementById('new-command').click();
        if (layout === 'markdown') document.getElementById('export').click();
      }
      setPlaying(Boolean(data.playing));
    }
  });
  document.addEventListener('pointerdown', event => {
    if (event.isTrusted) { manualOverride = true; if (playing) { setPlaying(false); typing = null; motion = null; status('已暂停，交给你操作', '演示不会抢回鼠标；继续演示或重置会恢复虚构示例。'); } }
  }, true);
  document.addEventListener('keydown', event => { if (event.isTrusted) { manualOverride = true; if (playing) { setPlaying(false); typing = null; motion = null; } } }, true);
  const style = document.createElement('style');
  style.textContent = '.demo-cursor{position:fixed;pointer-events:none;z-index:2147483647;font:26px/1 monospace;color:#fff;text-shadow:-1px -1px #153923,1px 1px #153923;filter:drop-shadow(0 2px 2px #0004)}.demo-cursor small{display:block;background:#2a7151;border-radius:3px;font:7px sans-serif;color:white;padding:3px;margin-left:12px;text-shadow:none}.demo-hit{outline:2px solid #79b398!important;outline-offset:2px}';
  document.head.append(style);
  cursor = document.createElement('div');
  cursor.className = 'demo-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.append(document.createTextNode('↖'));
  const label = document.createElement('small'); label.textContent = 'DEMO'; cursor.append(label);
  document.body.append(cursor);
  for (const id of ['markdown-file', 'markdown-todo', 'markdown-preview', 'markdown-apply', 'export-save-as', 'export-save-default']) {
    const control = document.getElementById(id);
    control.disabled = true;
    control.title = '演示不读写文件或导入个人数据。';
  }
  document.addEventListener('click', event => {
    if (event.target.closest('#export-save-as,#export-save-default,#markdown-todo,#markdown-preview,#markdown-apply,#markdown-file')) { event.preventDefault(); event.stopImmediatePropagation(); status('此 demo 不读写文件', '可以查看预览；完整导入导出请使用真实应用。'); }
  }, true);
  ready = true;
  emit('ready');
})();
