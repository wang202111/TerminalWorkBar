'use strict';

const byId = identifier => document.getElementById(identifier);
let toastTimer;

function announce(message) {
  clearTimeout(toastTimer);
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 4200);
}

async function copyText(identifier) {
  const target = byId(identifier);
  const content = target.textContent;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(content);
    announce('已复制。示例不会自动执行，请检查后再使用。');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    announce('浏览器未允许自动复制，已选中文本；请按 ⌘C / Ctrl+C。');
  }
}

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', () => copyText(button.dataset.copy));
});

const navigation = byId('navigation');
function closeMenu() {
  navigation.classList.remove('open');
  byId('menu-toggle').setAttribute('aria-expanded', 'false');
}
byId('menu-toggle').addEventListener('click', () => {
  const opened = navigation.classList.toggle('open');
  byId('menu-toggle').setAttribute('aria-expanded', String(opened));
});
navigation.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('click', event => {
  if (!navigation.contains(event.target) && !byId('menu-toggle').contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
  if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault();
    if (window.matchMedia('(max-width: 700px)').matches) {
      navigation.classList.add('open');
      byId('menu-toggle').setAttribute('aria-expanded', 'true');
    }
    byId('guide-search').focus();
  }
});

const chapters = [...document.querySelectorAll('.chapter')];
const searchIndex = chapters.map(section => ({
  id: section.id,
  title: section.dataset.title,
  content: section.textContent.replace(/\s+/g, ' ').trim(),
}));
byId('guide-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLocaleLowerCase();
  const results = byId('search-results');
  results.replaceChildren();
  results.hidden = !query;
  byId('chapter-nav').hidden = Boolean(query);
  if (!query) return;
  const tokens = query.split(/\s+/);
  const matches = searchIndex.filter(entry => tokens.every(token => (entry.title + ' ' + entry.content).toLocaleLowerCase().includes(token)));
  const status = document.createElement('p');
  status.textContent = matches.length ? `${matches.length} 个相关章节` : '没有找到。试试“SSH”“导入”或“路径”。';
  results.append(status);
  for (const entry of matches) {
    const link = document.createElement('a');
    link.href = '#' + entry.id;
    link.textContent = entry.title;
    const snippet = document.createElement('small');
    const position = entry.content.toLocaleLowerCase().indexOf(tokens[0]);
    snippet.textContent = (position > 25 ? '…' : '') + entry.content.slice(Math.max(0, position - 25), Math.max(0, position - 25) + 88) + '…';
    link.append(snippet);
    results.append(link);
  }
});

let scrollScheduled = false;
function updateChapter() {
  scrollScheduled = false;
  const current = [...chapters].reverse().find(section => section.getBoundingClientRect().top <= 140) || chapters[0];
  document.querySelectorAll('#chapter-nav a').forEach(link => {
    if (link.getAttribute('href') === '#' + current.id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', () => {
  if (!scrollScheduled) { scrollScheduled = true; requestAnimationFrame(updateChapter); }
}, { passive: true });
updateChapter();

let printDetails = [];
window.addEventListener('beforeprint', () => {
  printDetails = [...document.querySelectorAll('details')].filter(detail => !detail.open);
  printDetails.forEach(detail => { detail.open = true; });
});
window.addEventListener('afterprint', () => {
  printDetails.forEach(detail => { detail.open = false; });
  printDetails = [];
});
byId('print-guide').addEventListener('click', () => window.print());

const initialNodes = [
  { id: 'project', parent: '', title: '示例项目 Alpha', group: true, command: 'demo-ssh', note: '项目层也可以关联终端。这里的所有操作都是模拟。' },
  { id: 'environment', parent: 'project', title: '检查本地环境', command: 'demo-shell', note: '先验证本地环境，再准备远端连接。' },
  { id: 'release', parent: 'project', title: '准备发布', group: true, command: '', note: '将发布工作拆分到检查与验证，子级有独立的终端关联。' },
  { id: 'checklist', parent: 'release', title: '核对清单', command: 'demo-shell', note: '可以与“检查本地环境”关联同一个命令 ID。' },
  { id: 'review', parent: 'checklist', title: '验证结果', command: 'demo-ssh', note: '记录验证结论和下一步。四级节点也能关联自己的终端。' },
];
const demoCommands = {
  'demo-shell': { title: '本地开发', script: '/bin/zsh -l' },
  'demo-ssh': { title: '远端工作区', script: "ssh -t demo-dev 'tmux -u a -t workspace'" },
};
let demoNodes;
let expanded;
let selected;
let running;
let currentTerminal;

function currentNode() { return demoNodes.find(node => node.id === selected); }
function nodePath(node) {
  const labels = [node.title];
  let parent = node.parent;
  while (parent) {
    const ancestor = demoNodes.find(entry => entry.id === parent);
    labels.unshift(ancestor.title);
    parent = ancestor.parent;
  }
  return labels.join(' / ');
}
function renderTree() {
  function childrenOf(parent) {
    const list = document.createElement('ul');
    for (const node of demoNodes.filter(entry => entry.parent === parent)) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'tree-row' + (node.id === selected ? ' selected' : '');
      if (demoNodes.some(entry => entry.parent === node.id)) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'tree-toggle';
        toggle.textContent = expanded.has(node.id) ? '▾' : '▸';
        toggle.setAttribute('aria-label', `${expanded.has(node.id) ? '收起' : '展开'} ${node.title}`);
        toggle.setAttribute('aria-expanded', String(expanded.has(node.id)));
        toggle.addEventListener('click', () => {
          expanded.has(node.id) ? expanded.delete(node.id) : expanded.add(node.id);
          renderTree();
          const replacement = byId('demo-tree').querySelector(`[data-toggle="${node.id}"]`);
          if (replacement) replacement.focus({ preventScroll: true });
        });
        toggle.dataset.toggle = node.id;
        row.append(toggle);
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'tree-spacer';
        row.append(spacer);
      }
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'tree-select';
      choose.textContent = (node.group ? '▧ ' : '□ ') + node.title;
      choose.setAttribute('aria-pressed', String(node.id === selected));
      choose.dataset.node = node.id;
      choose.addEventListener('click', () => {
        selected = node.id;
        renderTree();
        renderNode();
        byId('demo-tree').querySelector(`[data-node="${node.id}"]`).focus({ preventScroll: true });
      });
      row.append(choose);
      if (node.command) {
        const badge = document.createElement('span');
        badge.className = 'tree-linked';
        badge.textContent = '›_';
        badge.title = '关联入口 ' + node.command;
        row.append(badge);
      }
      item.append(row);
      if (expanded.has(node.id) && demoNodes.some(entry => entry.parent === node.id)) item.append(childrenOf(node.id));
      list.append(item);
    }
    return list;
  }
  byId('demo-tree').replaceChildren(childrenOf(''));
}
function renderNode() {
  const node = currentNode();
  byId('demo-node-title').textContent = node.title;
  byId('demo-node-path').textContent = nodePath(node);
  byId('demo-note').textContent = node.note;
  byId('demo-command').value = node.command;
  byId('demo-open').disabled = !node.command;
}
function renderTerminalStatus() {
  byId('demo-instance-count').textContent = `${running.size} 个模拟运行入口`;
  byId('demo-disconnect').disabled = !currentTerminal || !running.has(currentTerminal);
}
function resetDemo() {
  demoNodes = initialNodes.map(node => ({ ...node }));
  expanded = new Set(['project', 'release', 'checklist']);
  selected = 'review';
  running = new Set();
  currentTerminal = '';
  byId('demo-terminal-title').textContent = 'Terminal · 等待打开';
  byId('demo-output').textContent = '欢迎来到安全演示。\n\n在右侧选择一个节点，点击「模拟打开终端」。\n再次点击同一入口，会定位而不是重新运行。\n\n所有命令都只是文字展示。\n▍';
  byId('demo-feedback').textContent = '试试选择“验证结果”，它也可以有自己的终端。';
  renderTree();
  renderNode();
  renderTerminalStatus();
}
byId('demo-command').addEventListener('change', event => {
  currentNode().command = event.target.value;
  renderTree();
  renderNode();
  byId('demo-feedback').textContent = '只更新了演示关联，没有执行命令。真实应用还需要点击“保存任务”。';
});
function openDemoTerminal() {
  const node = currentNode();
  if (!node.command) return;
  const command = demoCommands[node.command];
  const reused = running.has(node.command);
  running.add(node.command);
  currentTerminal = node.command;
  byId('demo-terminal-title').textContent = command.title + ' · ' + node.command;
  byId('demo-output').textContent = reused
    ? `[模拟] 找到运行中的入口：${node.command}\n\n→ 定位已有 iTerm2 pane\n→ 没有发送命令文字\n→ 没有重新建立 SSH / tmux 连接\n\n原来的工作继续运行。\n▍`
    : `[模拟] 查找入口：${node.command}\n→ 当前没有运行实例\n→ 创建 iTerm2 终端\n\n$ ${command.script}\n\n仅展示启动过程，未执行任何命令。\n▍`;
  byId('demo-feedback').textContent = reused ? '已模拟定位已有终端。重复点击不会重新执行脚本。' : '已模拟首次打开。再点一次，观察“复用”行为。';
  renderTerminalStatus();
}
byId('demo-open').addEventListener('click', openDemoTerminal);
byId('demo-disconnect').addEventListener('click', () => {
  running.delete(currentTerminal);
  byId('demo-output').textContent = `[模拟] ${currentTerminal} 的本机连接已结束。\n运行锁释放，再次点击会重新打开。\n\n这不代表远端 tmux 任务被删除。`;
  byId('demo-feedback').textContent = '连接已模拟结束。再点同一入口，可以看到重新执行的过程。';
  renderTerminalStatus();
});
byId('demo-expand').addEventListener('click', () => { expanded = new Set(demoNodes.map(node => node.id)); renderTree(); });
byId('demo-collapse').addEventListener('click', () => { expanded.clear(); renderTree(); });
resetDemo();

const tourScenes = [
  { label: '认识界面', title: '认识工作区', description: '左边执行，右边组织。演示用的终端和主机都是虚构的，不操作真实应用。' },
  { label: '添加任务', title: '添加一个细粒度任务', description: '在项目下面继续细分。填写名称与上级节点，暂时不需要离开任务窗口。' },
  { label: '新建入口', title: '在关联窗口里新建终端', description: '选择虚构 SSH 别名与 tmux session。模拟保存只写配置，不建立连接。' },
  { label: '保存关联', title: '回到原任务，保存关联', description: '先保存入口，再保存任务。现在树上的节点有了自己的终端按钮，仍未执行。' },
  { label: '首次打开', title: '明确点击，才开始执行', description: '首次点击没有运行实例，创建本机 iTerm2 终端并执行启动脚本。这里仅展示文字。' },
  { label: '再次定位', title: '再次点击，回到原来的现场', description: '同一个命令 ID 已在运行：只定位已有 pane，不再发送命令，不重新连接。' },
  { label: '导出记录', title: '把任务与记录带回 Markdown', description: '选择阅读版分享，或可回导版继续编辑。这段动画不会生成或保存任何文件。' },
];
let tourIndex = 0;
let tourPlaying = false;
let tourMode = false;
let tourTimer;
let tourStarted = 0;
let tourRemaining = 4200;
const demoWindow = document.querySelector('.demo-window');

function sceneField(label, value) {
  const field = document.createElement('div');
  field.className = 'scene-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const content = document.createElement('div');
  content.textContent = value;
  field.append(caption, content);
  return field;
}
function showSceneForm(title, fields, action, note) {
  const panel = byId('tour-scene');
  panel.replaceChildren();
  const label = document.createElement('span');
  label.className = 'tiny-label';
  label.textContent = '界面示意 · 不是实际输入表单';
  const heading = document.createElement('h3');
  heading.textContent = title;
  panel.append(label, heading);
  for (const [caption, value] of fields) panel.append(sceneField(caption, value));
  const cta = document.createElement('span');
  cta.className = 'scene-cta';
  cta.textContent = action;
  const footnote = document.createElement('p');
  footnote.className = 'scene-footnote';
  footnote.textContent = note;
  panel.append(cta, footnote);
  byId('tour-overlay').hidden = false;
}
function updateTourControls() {
  byId('tour-play').textContent = tourPlaying ? 'Ⅱ 暂停' : tourMode && tourIndex === tourScenes.length - 1 ? '↻ 重新播放' : tourMode ? '▶ 继续播放' : '▶ 播放演示';
  byId('tour-play').setAttribute('aria-pressed', String(tourPlaying));
  byId('tour-previous').disabled = tourIndex === 0;
  byId('tour-next').disabled = tourIndex === tourScenes.length - 1;
  byId('tour-counter').textContent = `${String(tourIndex + 1).padStart(2, '0')} / 07`;
  document.querySelectorAll('[data-scene]').forEach(button => {
    const index = Number(button.dataset.scene);
    button.setAttribute('aria-pressed', String(tourMode && index === tourIndex));
    button.classList.toggle('completed', tourMode && index < tourIndex);
  });
}
function clearSceneEffects() {
  byId('tour-overlay').hidden = true;
  byId('tour-pointer').hidden = true;
  demoWindow.querySelectorAll('.tour-glow').forEach(element => element.classList.remove('tour-glow'));
}
function renderTourScene() {
  tourMode = true;
  demoWindow.classList.add('tour-mode');
  demoWindow.classList.remove('tour-paused');
  clearSceneEffects();
  resetDemo();
  document.querySelectorAll('.demo-tree-actions, #demo-tree, .demo-node-detail, .terminal-status').forEach(element => { element.inert = true; });
  if (tourIndex >= 1) {
    demoNodes = demoNodes.filter(node => node.id !== 'review');
    selected = 'checklist';
    renderTree();
    renderNode();
  }
  if (tourIndex === 1) {
    showSceneForm('添加任务', [['节点名称', '验证结果'], ['节点类型', '任务 / 步骤'], ['上级节点', '示例项目 Alpha / 准备发布 / 核对清单'], ['本级关联终端', '暂不关联']], '＋ 新建终端并关联', '无需先切换到终端入口列表。');
    byId('tour-pointer').hidden = false;
  }
  if (tourIndex === 2) {
    showSceneForm('新建终端并关联', [['类型', 'SSH + tmux（向导）'], ['本机 SSH 别名（虚构）', 'demo-dev'], ['tmux session', 'workspace'], ['链接 ID', 'demo-ssh']], '保存入口，不执行', '模拟保存配置，不连接服务器、不创建 tmux。');
    byId('tour-pointer').hidden = false;
  }
  if (tourIndex >= 3) {
    demoNodes.push({ ...initialNodes.find(node => node.id === 'review') });
    selected = 'review';
    renderTree();
    renderNode();
  }
  if (tourIndex === 3) {
    showSceneForm('回到任务，保存关联', [['节点名称', '验证结果'], ['已选择的终端', '远端工作区 · demo-ssh']], '保存任务', '两次保存完成。仍然没有执行任何命令。');
    byId('tour-pointer').hidden = false;
  }
  if (tourIndex >= 4) {
    openDemoTerminal();
    if (tourIndex >= 5) openDemoTerminal();
    document.querySelector('.demo-terminal').classList.add('tour-glow');
    byId('demo-open').classList.add('tour-glow');
  }
  if (tourIndex === 6) {
    showSceneForm('导出 Markdown', [['格式', '可回导 Markdown（保留 ID）']], '选择文件位置并保存…', '实际应用需要你明确选择位置；此处不保存文件。');
    const preview = document.createElement('pre');
    preview.className = 'scene-code';
    preview.textContent = '- [ ] 核对清单\n  - [ ] 验证结果\n    > 已记录检查结论与下一步。';
    byId('tour-scene').insertBefore(preview, byId('tour-scene').querySelector('.scene-cta'));
  }
  const scene = tourScenes[tourIndex];
  byId('tour-title').textContent = `${String(tourIndex + 1).padStart(2, '0')} · ${scene.title}`;
  byId('tour-description').textContent = scene.description;
  byId('demo-feedback').textContent = '当前为动画示意。点“自由体验”后，可以自己展开层级、切换关联和模拟打开。';
  byId('tour-scene').style.animation = 'none';
  byId('tour-pointer').style.animation = 'none';
  void byId('tour-scene').offsetWidth;
  byId('tour-scene').style.animation = '';
  byId('tour-pointer').style.animation = '';
  updateTourControls();
}
function pauseTour() {
  if (tourPlaying) tourRemaining = Math.max(0, tourRemaining - (performance.now() - tourStarted) * Number(byId('tour-speed').value));
  clearTimeout(tourTimer);
  tourPlaying = false;
  demoWindow.classList.add('tour-paused');
  updateTourControls();
}
function scheduleTour() {
  tourStarted = performance.now();
  tourTimer = setTimeout(() => {
    if (!tourPlaying) return;
    if (tourIndex >= tourScenes.length - 1) {
      tourPlaying = false;
      byId('tour-description').textContent = '演示结束。可以重新播放、跳到任一步，或者切换到自由体验。没有执行真实操作。';
      updateTourControls();
      return;
    }
    tourIndex += 1;
    tourRemaining = 4200;
    renderTourScene();
    scheduleTour();
  }, tourRemaining / Number(byId('tour-speed').value));
}
function selectTourScene(index) {
  pauseTour();
  tourIndex = index;
  tourRemaining = 4200;
  renderTourScene();
}
function exitTour() {
  pauseTour();
  tourMode = false;
  tourIndex = 0;
  tourRemaining = 4200;
  clearSceneEffects();
  demoWindow.classList.remove('tour-mode', 'tour-paused');
  document.querySelectorAll('.demo-tree-actions, #demo-tree, .demo-node-detail, .terminal-status').forEach(element => { element.inert = false; });
  resetDemo();
  byId('tour-title').textContent = '自由体验 · 仍然只是一份安全模拟';
  byId('tour-description').textContent = '在右侧选择任意层级，调整关联后模拟打开。随时点播放回到动画。';
  updateTourControls();
}
tourScenes.forEach((scene, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.scene = String(index);
  button.textContent = scene.label;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => selectTourScene(index));
  byId('tour-steps').append(button);
});
byId('tour-play').addEventListener('click', () => {
  if (tourPlaying) { pauseTour(); return; }
  if (!tourMode || tourIndex === tourScenes.length - 1) {
    tourIndex = 0;
    tourRemaining = 4200;
    renderTourScene();
  }
  tourPlaying = true;
  demoWindow.classList.remove('tour-paused');
  updateTourControls();
  scheduleTour();
});
byId('tour-previous').addEventListener('click', () => selectTourScene(Math.max(0, tourIndex - 1)));
byId('tour-next').addEventListener('click', () => selectTourScene(Math.min(tourScenes.length - 1, tourIndex + 1)));
byId('tour-free').addEventListener('click', exitTour);
byId('demo-reset').addEventListener('click', exitTour);
byId('tour-speed').addEventListener('change', () => {
  clearTimeout(tourTimer);
  tourRemaining = 4200;
  if (tourPlaying) scheduleTour();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && tourPlaying) pauseTour(); });
updateTourControls();

function setMarkdownFormat(format) {
  const examples = window.GUIDE_EXAMPLES;
  if (!examples || typeof examples[format] !== 'string') {
    byId('markdown-source').textContent = '示例资源缺失。请保持网站文件夹完整，或从本页下载 Markdown 文件。';
    return;
  }
  byId('markdown-source').textContent = examples[format];
  document.querySelectorAll('[data-format]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
  byId('markdown-explanation').textContent = format === 'pretty'
    ? '阅读版：标准缩进与复选框，适合阅读分享；改名或移动后不保证精确匹配原节点。'
    : '回导版：HTML 注释保存节点 ID、类型和记录时间；阅读时隐藏，编辑时请保留。导入仍需预览确认。';
  byId('markdown-download').href = format === 'pretty' ? 'examples/tasks.md' : 'examples/tasks.roundtrip.md';
}
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => setMarkdownFormat(button.dataset.format)));
setMarkdownFormat('pretty');

byId('delete-mode').addEventListener('change', event => {
  const subtree = event.target.value === 'subtree';
  byId('delete-preview').textContent = subtree ? '示例项目\n└ 日常维护' : '示例项目\n├ 核对清单\n├ 验证结果\n└ 日常维护';
  byId('delete-impact').textContent = subtree
    ? '移除 3 个节点及它们的记录。终端入口和远端 tmux 不受影响。这里只改变示意图。'
    : '移除 1 个节点及它自己的记录，两个子级上移。这里只改变示意图，不删除真实内容。';
});
