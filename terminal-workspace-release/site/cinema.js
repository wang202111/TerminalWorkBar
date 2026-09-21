'use strict';

const byId = identifier => document.getElementById(identifier);
const clamp = value => Math.max(0, Math.min(1, value));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const stage = byId('stage');
const camera = byId('camera');
let cameraScale = 1;
let activeClip = 'main';
let typingTracks = [];
let activeScene = -1;
let eventCount = 0;
let localTime = 0;
let position = 0;
let playing = !reducedMotion.matches;
let frameHandle = 0;
let lastFrame = 0;
let speed = 1.5;
let resumeAfterVisibility = false;
let modalOpened = -1000;
let cursorPosition = { x: 55, y: 68 };
let targetCache = new Map();
let cinematicRows = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function terminal(lines, state = 'LOCAL / READY') {
  byId('terminal-output').replaceChildren();
  lines.forEach((text, index) => {
    const line = element('div', 'terminal-line' + (index === 0 ? ' dim' : ''), text);
    line.id = 'terminal-line-' + index;
    byId('terminal-output').append(line);
  });
  byId('terminal-output').append(element('div', 'terminal-caret', '▍'));
  byId('terminal-state').textContent = state;
}

function typeInto(identifier, text, duration = 1100, delay = 0) {
  typingTracks = typingTracks.filter(track => track.identifier !== identifier);
  typingTracks.push({ identifier, text, duration, start: localTime + delay });
  const target = byId(identifier);
  if (target) target.textContent = '';
}

function drawTyping(time) {
  for (const track of typingTracks) {
    const target = byId(track.identifier);
    if (!target) continue;
    const progress = clamp((time - track.start) / track.duration);
    target.textContent = track.text.slice(0, Math.floor(track.text.length * progress));
    target.classList.toggle('typing', progress < 1);
  }
}

function rows(options = {}) {
  cinematicRows = [
    { id: 'project', title: 'Atlas · 示例项目', depth: 0, group: true, linked: true },
    { id: 'environment', title: '检查本地环境', depth: 1, linked: true },
    { id: 'release', title: '准备发布', depth: 1, group: true },
    { id: 'checklist', title: '核对清单', depth: 2, linked: true },
    { id: 'review', title: '验证中文输出', depth: 3, linked: true },
  ];
  if (options.withoutReview) cinematicRows = cinematicRows.filter(row => row.id !== 'review');
  if (options.collapsed) cinematicRows = cinematicRows.slice(0, 1);
  if (options.promote) cinematicRows = cinematicRows.filter(row => row.id !== 'release').map(row => ({ ...row, depth: Math.max(0, row.depth - (['checklist', 'review'].includes(row.id) ? 1 : 0)) }));
  if (options.subtree) cinematicRows = cinematicRows.filter(row => !['release', 'checklist', 'review'].includes(row.id));
  if (options.filter) cinematicRows = cinematicRows.filter(row => ['project', 'release', 'checklist', 'review'].includes(row.id));
  if (options.moved) cinematicRows = cinematicRows.map(row => row.id === 'review' ? { ...row, depth: 1 } : row);
  drawRows(options);
}

function drawRows(options = {}) {
  byId('workspace-list').replaceChildren();
  byId('tasks-tab').querySelector('b').textContent = String(cinematicRows.filter(entry => !entry.group && !(options.done && entry.id === 'review')).length);
  byId('tasks-tab').classList.add('active');
  byId('commands-tab').classList.remove('active');
  for (const entry of cinematicRows) {
    const row = element('div', 'tree-node' + (entry.id === (options.selected || 'review') ? ' selected' : '') + (options.done && entry.id === 'review' ? ' done' : ''));
    row.id = 'row-' + entry.id;
    row.style.paddingLeft = (7 + entry.depth * (window.innerWidth < 520 ? 8 : 13)) + 'px';
    const symbol = element('span', 'node-symbol', entry.group ? '▾' : options.done && entry.id === 'review' ? '☑' : '□');
    symbol.id = 'check-' + entry.id;
    row.append(symbol, element('span', 'node-title', entry.title));
    if (entry.linked) {
      const jump = element('span', 'node-terminal', '›_');
      jump.id = 'jump-' + entry.id;
      row.append(jump);
    }
    const edit = element('span', 'node-edit', '···');
    edit.id = 'edit-' + entry.id;
    row.append(edit);
    byId('workspace-list').append(row);
  }
}

function field(identifier, label, value) {
  const wrapper = element('div', 'field');
  wrapper.append(element('div', 'field-label', label));
  const input = element('div', 'field-value', value);
  input.id = identifier;
  wrapper.append(input);
  return wrapper;
}

function modal(title, tag, fields, action, hint = '') {
  byId('modal-title').textContent = title;
  byId('modal-tag').textContent = tag;
  byId('modal-content').replaceChildren(...fields.map(entry => field(...entry)));
  byId('modal-action').textContent = action;
  byId('modal-action').classList.remove('danger');
  byId('modal-hint').textContent = hint;
  byId('modal-layer').hidden = false;
  modalOpened = localTime;
}

function closeModal() { byId('modal-layer').hidden = true; }
function toast(text) {
  byId('scene-toast-text').textContent = text;
  byId('scene-toast').hidden = false;
}
function banner(text) {
  byId('terminal-banner').textContent = text;
  byId('terminal-banner').hidden = false;
}
function addResult(text, identifier = 'result-option') {
  const option = element('div', 'result-option', text);
  option.id = identifier;
  byId('modal-content').append(option);
}
function preview(text) {
  const source = element('pre', 'code-preview', text);
  source.id = 'code-preview';
  byId('modal-content').append(source);
}
function commandList() {
  byId('workspace-list').replaceChildren();
  byId('commands-tab').querySelector('b').textContent = '2';
  byId('tasks-tab').classList.remove('active');
  byId('commands-tab').classList.add('active');
  for (const [identifier, title, command] of [['remote', '远端工作区', 'demo-ssh · demo-dev / workspace'], ['local', '本地检查', 'demo-shell · /bin/zsh -lc']]) {
    const card = element('div', 'command-card');
    card.id = 'command-' + identifier;
    card.append(element('strong', '', title), element('p', '', command));
    const actions = element('div', 'command-actions');
    for (const [key, label] of [['open', '打开'], ['edit', '编辑'], ['delete', '删除']]) {
      const action = element('span', '', label);
      action.id = key + '-' + identifier;
      actions.append(action);
    }
    card.append(actions);
    byId('workspace-list').append(card);
  }
}

const event = (at, target, run) => ({ at, target, run, clickAt: at + 600 });
const libraryScenes = [
  {
    label: '打开工作台', title: '打开 App，任务就在终端旁边', duration: 5500,
    description: '右侧 Toolbelt 是工作入口；这里只模拟启动，不打开真实应用。',
    setup() { modal('Terminal Sidebar', 'LAUNCH / SIMULATION', [['launch-app', '应用', '›_ Terminal Sidebar.app']], '打开工作台', '已准备好 iTerm2 Python API · 演示环境'); },
    events: [event(700, 'modal-action', () => { closeModal(); toast('工作台已就绪 · 右侧任务树'); }), event(3000, 'row-project', () => { rows({ selected: 'project' }); })],
  },
  {
    label: '展开与收起', title: '项目 → 阶段 → 步骤，逐级展开', duration: 6500,
    description: '目录与任务都可以有子级；任意层级都能关联自己的终端。',
    setup() { rows({ collapsed: true }); },
    events: [event(400, 'row-project', () => rows({ withoutReview: true })), event(2000, 'expand-all', () => rows()), event(3800, 'collapse-all', () => rows({ collapsed: true })), event(5100, 'expand-all', () => rows())],
  },
  {
    label: '添加细粒度任务', title: '不用换窗口，继续细分工作', duration: 7000,
    description: '填写名称，选择父级，再在同一个编辑窗口关联终端。',
    setup() { rows({ withoutReview: true }); },
    events: [
      event(300, 'add-task', () => modal('添加任务', 'NEW TASK', [['task-name', '节点名称', ''], ['task-parent', '上级节点', 'Atlas / 准备发布 / 核对清单'], ['task-terminal', '本级关联终端', '暂不关联']], '＋ 新建终端并关联', '任务草稿保留，不需要先去另一页新建终端。')),
      event(1700, 'task-name', () => typeInto('task-name', '验证中文输出', 1200)),
      event(4200, 'task-parent', () => { byId('task-parent').style.borderColor = '#7e9d64'; }),
      event(5400, 'modal-action', () => toast('下一步：直接新建终端并关联')),
    ],
  },
  {
    label: 'SSH 选择与关联', title: '从本机 SSH 别名里选，不必记地址', duration: 8500,
    description: '选择候选、重读配置，再填 tmux session。保存配置不执行命令。',
    setup() { modal('新建终端并关联', 'SSH + TMUX', [['ssh-host', '从本机 SSH 配置选择', '选择别名 ⌄'], ['tmux-session', 'tmux session', ''], ['command-id', '链接 ID', 'demo-ssh']], '保存入口，不执行', '本动画使用虚构候选，不读取你的 ~/.ssh/config。'); },
    events: [
      event(400, 'ssh-host', () => { addResult('demo-dev     ·     开发环境', 'host-choice'); addResult('demo-staging ·     测试环境', 'host-other'); }),
      event(1600, 'host-choice', () => { byId('ssh-host').textContent = 'demo-dev'; byId('host-choice').remove(); byId('host-other').remove(); }),
      event(2800, 'tmux-session', () => typeInto('tmux-session', 'workspace', 900)),
      event(4500, 'command-id', () => { addResult('↻ 重读 SSH 配置', 'reload-hosts'); }),
      event(5500, 'reload-hosts', () => { byId('reload-hosts').textContent = '✓ 候选已刷新 · 保留已选主机'; }),
      event(6900, 'modal-action', () => { closeModal(); toast('入口已保存 · 尚未执行'); }),
    ],
  },
  {
    label: '查询与创建 tmux', title: '已有会话直接选，没有就明确创建', duration: 10000,
    description: '真实查询会发起只读 SSH；创建必须确认。此处只演示界面变化。',
    setup() { modal('远端 tmux 会话', 'DISCOVER / CREATE', [['ssh-host', 'SSH 主机', 'demo-dev'], ['tmux-session', 'session', 'workspace']], '查询远端', '打开时若不存在则创建：也可以选择此策略，保存时不执行。'); },
    events: [
      event(500, 'modal-action', () => { addResult('⟳ 查询中…'); }),
      event(2000, 'result-option', () => { byId('result-option').textContent = 'workspace · 2 windows · 1 attached'; addResult('＋ 现在创建远端 session', 'create-now'); }),
      event(3700, 'create-now', () => modal('确认创建远端 session', 'EXPLICIT CONFIRMATION', [['new-session', '新 session 名称', '']], '确认创建', '只创建新会话，不关闭、重命名或踢掉现有客户端。')),
      event(4900, 'new-session', () => typeInto('new-session', 'demo-review', 850)),
      event(7000, 'modal-action', () => { closeModal(); toast('模拟创建 demo-review 成功 · 没有访问服务器'); }),
    ],
  },
  {
    label: 'window 与自动创建', title: '选到具体窗口，把创建时机说清楚', duration: 7000,
    description: 'session 内可指定 window；勾选“打开时创建”只保存策略，现在不会执行。',
    setup() { modal('SSH + tmux 向导', 'WINDOW / CREATE ON OPEN', [['tmux-session', 'session', 'workspace'], ['tmux-window', 'window（可选）', ''], ['create-policy', '创建策略', '☐ 打开时，若不存在则创建 session / window']], '保存入口，不执行'); },
    events: [event(400, 'tmux-window', () => typeInto('tmux-window', 'build', 900)), event(2600, 'create-policy', () => { byId('create-policy').textContent = '☑ 打开时，若不存在则创建 session / window'; }), event(4800, 'modal-action', () => { closeModal(); toast('创建策略已保存 · 等待明确打开时才执行'); })],
  },
  {
    label: '保存与首次打开', title: '两次保存之后，点击才执行', duration: 9000,
    description: '保存入口 → 保存任务 → 打开终端。三个动作，各有明确边界。',
    setup() { modal('保存任务关联', 'LINK TO TERMINAL', [['task-name', '节点名称', '验证中文输出'], ['task-terminal', '本级关联终端', '远端工作区 · demo-ssh']], '保存任务', '已保存的入口回填到任务草稿。'); },
    events: [
      event(500, 'modal-action', () => { closeModal(); rows(); toast('任务已保存 · 不执行命令'); }),
      event(2800, 'jump-review', () => { byId('scene-toast').hidden = true; byId('terminal-tab').textContent = 'demo-ssh · 远端工作区'; terminal(['$ ', '', '', ''], 'SSH / CONNECTING'); typeInto('terminal-line-0', "$ ssh -t demo-dev 'tmux -u a -t workspace'", 1500); typeInto('terminal-line-2', '[模拟] 已进入 workspace', 850, 1800); typeInto('terminal-line-3', '中文显示正常。继续你的工作。', 800, 2800); }),
      event(6800, 'terminal-tab', () => { byId('terminal-state').textContent = 'TMUX / workspace / UTF-8'; banner('✓ 首次打开 · 一个受管理的终端'); }),
    ],
  },
  {
    label: '再次点击与复用', title: '再次点击，不是再执行一遍', duration: 6000,
    description: '同一命令 ID 仍在运行 → 定位现有 pane，不向 shell 发送文字。',
    events: [event(700, 'jump-review', () => banner('↗ 已定位现有 pane · 没有发送新命令')), event(3000, 'jump-project', () => { banner('↗ 项目也关联 demo-ssh · 仍复用同一终端'); toast('继续原来的工作，不打断会话'); })],
  },
  {
    label: '记录与完成状态', title: '把结论留在节点上', duration: 7500,
    description: '展开记录，输入下一步，保存并完成本级任务；不自动采集终端输出。',
    events: [
      event(400, 'row-review', () => { rows(); byId('notes-panel').hidden = false; }),
      event(1800, 'note-input', () => typeInto('note-input', 'UTF-8 验证通过。下一步：整理发布检查。', 1500)),
      event(4200, 'save-note', () => { byId('note-content').textContent = '09:41 · UTF-8 验证通过。下一步：整理发布检查。'; typingTracks = []; byId('note-input').textContent = '记录已保存'; }),
      event(5800, 'check-review', () => { rows({ done: true }); toast('本级已完成 · 子级状态独立'); }),
    ],
  },
  {
    label: '编辑与移动层级', title: '改名、改父级，关联留在原处', duration: 7500,
    description: '修改上级节点会移动子树；不会自动继承或替换终端关联。',
    events: [
      event(400, 'edit-review', () => modal('编辑任务', 'EDIT / MOVE', [['task-name', '节点名称', '验证中文输出'], ['task-parent', '上级节点', 'Atlas / 准备发布 / 核对清单'], ['task-terminal', '终端关联', 'demo-ssh · 保持不变']], '保存任务')),
      event(1800, 'task-name', () => typeInto('task-name', '验证结果 · 已检查', 1200)),
      event(3700, 'task-parent', () => { byId('task-parent').textContent = 'Atlas · 示例项目'; }),
      event(5500, 'modal-action', () => { closeModal(); rows({ moved: true }); byId('row-review').querySelector('.node-title').textContent = '验证结果 · 已检查'; toast('层级已移动 · 终端关联保留'); }),
    ],
  },
  {
    label: '搜索与筛选', title: '层级再深，也能马上找到', duration: 6500,
    description: '搜索节点或记录，切换全部 / 已完成。筛选不会删除任务。',
    events: [event(400, 'search-box', () => typeInto('search-box', '验证', 800)), event(2100, 'status-filter', () => { rows({ filter: true }); byId('status-filter').textContent = '全部 ⌄'; }), event(3800, 'status-filter', () => { rows({ filter: true, done: true }); byId('status-filter').textContent = '已完成 ⌄'; }), event(5300, 'search-box', () => { typingTracks = []; byId('search-box').textContent = '⌕ 搜索任意层级或记录'; byId('status-filter').textContent = '未完成 ⌄'; rows(); })],
  },
  {
    label: '终端编辑与本地脚本', title: '命令也能编辑，入口 ID 保持稳定', duration: 9000,
    description: '支持 SSH + tmux、远端多行指令、本地 Shell。修改不会重跑运行中的终端。',
    events: [
      event(300, 'commands-tab', commandList),
      event(1700, 'edit-local', () => modal('编辑终端入口', 'SHARED WITH V1', [['mode-field', '类型', '本地 Shell 脚本'], ['script-field', '执行指令', ''], ['command-id', '链接 ID（固定）', 'demo-shell']], '保存入口，不执行', '与 Terminal Jump 共用配置；已有链接仍然有效。')),
      event(2900, 'script-field', () => typeInto('script-field', "printf 'Environment ready\\n'\npwd", 1700)),
      event(5600, 'modal-action', () => { closeModal(); toast('入口已更新 · 运行中的终端不重启'); }),
      event(7200, 'tasks-tab', () => rows()),
    ],
  },
  {
    label: '远端多行与工作目录', title: '环境、目录和启动指令，显式写清楚', duration: 8500,
    description: 'SSH 多行指令在远端执行；本地工作目录是 Mac 的路径，两者不同。',
    setup() { modal('SSH 远端多行指令', 'REMOTE SCRIPT', [['ssh-host', 'SSH 主机', 'demo-dev'], ['remote-script', '远端执行指令', ''], ['local-cwd', '本地工作目录（可选）', '']], '保存入口，不执行', '脚本示意：使用账号已配置的 HOME，不启动阻塞的交互 zsh。'); },
    events: [event(400, 'remote-script', () => typeInto('remote-script', 'cd "$HOME"\nexec tmux -u a -t workspace', 1800)), event(3700, 'local-cwd', () => typeInto('local-cwd', '~/Documents', 1000)), event(6100, 'modal-action', () => { closeModal(); toast('脚本配置已保存 · 仍未执行'); })],
  },
  {
    label: 'Markdown 导出', title: '阅读漂亮，回导准确', duration: 8500,
    description: '切换两种 Markdown，预览层级，再选文件位置。已有文件不覆盖。',
    events: [
      event(400, 'export-button', () => { modal('导出 Markdown', 'EXPORT', [['export-format', '导出格式', '清爽层级 Markdown']], '选择文件位置并保存…', '下方是导出预览。'); preview('# Atlas · 示例项目\n- [ ] 核对清单\n  - [x] 验证中文输出\n    > UTF-8 验证通过。'); }),
      event(2500, 'export-format', () => { byId('export-format').textContent = '可回导 Markdown · 保留 ID'; byId('code-preview').textContent = '- [x] 验证中文输出\n  <!-- ts-node: {"id":"demo-review"} -->\n  > UTF-8 验证通过。'; byId('modal-hint').textContent = '源码示意：稳定 ID 用于精确改名与移动；实际格式见手册。'; }),
      event(4700, 'modal-action', () => modal('选择保存位置', 'SAVE AS / SIMULATION', [['file-name', '另存为', 'Atlas-roundtrip.md'], ['save-folder', '位置', 'Documents / Notes']], '保存', '模拟系统文件选择器，不写入任何文件。')),
      event(6800, 'modal-action', () => { closeModal(); toast('模拟导出完成 · 可交给 Markdown 编辑器'); }),
    ],
  },
  {
    label: 'Markdown 导入', title: '先预览变化，再确认写入', duration: 8500,
    description: '改名和缩进保留 ID；遗漏的节点不删除，导入不会创建或执行终端命令。',
    events: [
      event(400, 'import-button', () => modal('导入 Markdown', 'IMPORT / PREVIEW', [['import-file', '选择文件', 'Atlas-roundtrip.md'], ['import-content', '文件内容', '']], '预览导入', '可选择文件、粘贴，或读取当前 TODO。')),
      event(1800, 'import-content', () => typeInto('import-content', '- [ ] 发布复盘\n  - [x] 验证结果', 1400)),
      event(4000, 'modal-action', () => { addResult('新增 1 · 更新 1 · 未变 4'); byId('modal-action').textContent = '确认导入'; byId('modal-hint').textContent = '没有出现在文件中的节点会保留。'; }),
      event(6200, 'modal-action', () => { closeModal(); cinematicRows.push({ id: 'imported', title: '发布复盘', depth: 1 }); drawRows({ selected: 'imported' }); toast('预览已确认 · 只更新任务库'); }),
    ],
  },
  {
    label: '笔记 URL 与 V1', title: '在笔记里点一下，回到工作现场', duration: 8000,
    description: 'terminal-jump:// 只携带入口 ID。V1 与侧栏共享命令，不自动同步笔记。',
    setup() { modal('Atlas / 工作笔记', 'OBSIDIAN / SIMULATION', [['note-link', 'Markdown 链接', '[开发终端](terminal-jump://open/demo-ssh)']], '↗ 打开开发终端', '本动画不会调用 URL 协议。'); },
    events: [event(700, 'modal-action', () => { closeModal(); banner('↗ 从笔记链接定位 demo-ssh'); }), event(3000, 'v1-button', () => modal('Terminal Jump · V1', 'SHARED COMMAND CATALOG', [['v1-entry', '命令入口', 'demo-ssh · 远端工作区'], ['v1-local', '本地入口', 'demo-shell · 本地检查']], '打开 / 定位', '第一版独立可用；修改入口会影响两边。')), event(5800, 'modal-action', () => { closeModal(); banner('✓ 同一个入口，同一个工作现场'); })],
  },
  {
    label: '删除节点与子树', title: '只删本级，还是整棵？先看范围', duration: 10000,
    description: '删除前有独立备份；不关闭终端，不删除远端 tmux，不改原始 Markdown。',
    events: [
      event(300, 'edit-release', () => modal('删除“准备发布”？', 'DELETE / SCOPE', [['delete-scope', '删除范围', '只删除本级，保留子级并上移']], '确认删除', '将删除 1 个节点；2 个后代节点保留。')),
      event(2200, 'modal-action', () => { closeModal(); rows({ promote: true }); toast('仅本级移除 · 子级上移 · 备份已保留（模拟）'); }),
      event(4100, 'row-checklist', () => { byId('scene-toast').hidden = true; rows(); modal('另一种范围（独立示例）', 'DELETE SUBTREE', [['delete-scope', '删除范围', '删除本级及所有子级']], '确认删除整棵', '重新使用虚构示例：将删除 3 个节点及记录。'); byId('modal-action').classList.add('danger'); }),
      event(7000, 'modal-action', () => { closeModal(); rows({ subtree: true }); toast('整棵子树已模拟移除 · 远端会话不受影响'); }),
    ],
  },
  {
    label: '删除终端入口', title: '删入口，不等于停掉远端工作', duration: 6500,
    description: '两版共用入口都会移除；任务保留，旧链接失效，已打开的终端不关闭。',
    setup: commandList,
    events: [event(700, 'delete-remote', () => { modal('删除终端入口？', 'DELETE COMMAND', [['delete-command', '入口', 'demo-ssh · 远端工作区']], '确认删除入口', '已有任务关联和外部 URL 将失效。不会关闭 SSH / tmux。'); byId('modal-action').classList.add('danger'); }), event(3300, 'modal-action', () => { closeModal(); byId('command-remote').remove(); byId('commands-tab').querySelector('b').textContent = '1'; banner('远端工作仍在运行'); toast('入口配置已模拟移除 · 终端未关闭'); })],
  },
];

const heroScenes = [
  {
    label: '层级', title: '再细的步骤，也有自己的位置。', description: '从项目到具体任务。镜头跟着工作，而不是让你找按钮。', duration: 5000,
    shots: [[0, .5, .5, 1], [1200, .78, .53, 1.72], [4100, .78, .56, 1.72]],
    setup() { rows({ collapsed: true }); },
    events: [event(200, 'row-project', () => rows({ withoutReview: true })), event(1700, 'expand-all', () => rows()), event(3300, 'row-review', () => rows({ selected: 'review' }))],
  },
  {
    label: '关联', title: '不用离开任务，就能准备好终端。', description: '新建入口 → 保存关联。到这里，没有执行任何命令。', duration: 7500,
    shots: [[0, .5, .5, 1], [1100, .5, .5, 1.2], [5400, .5, .5, 1.2], [6900, .78, .55, 1.6]],
    setup() { modal('新建终端并关联', 'LINK YOUR WORKSPACE', [['ssh-host', 'SSH 主机（虚构别名）', 'demo-dev'], ['tmux-session', 'tmux session', '']], '保存入口，不执行', '入口直接回填任务，无需切换窗口。'); },
    events: [event(400, 'tmux-session', () => typeInto('tmux-session', 'workspace', 850)), event(2200, 'modal-action', () => modal('终端已经准备好', 'SAVE ASSOCIATION', [['task-name', '任务', '验证中文输出'], ['task-terminal', '本级关联', 'demo-ssh · 远端工作区']], '保存任务', '最后确认任务关联。')), event(4300, 'modal-action', () => { closeModal(); rows(); toast('已关联 · 尚未执行'); })],
  },
  {
    label: '打开', title: '一点，直达你的工作现场。', description: '现在才打开终端，连接 SSH，进入 tmux。仅模拟展示。', duration: 6500,
    shots: [[0, .78, .55, 1.6], [1100, .78, .55, 1.6], [2300, .26, .43, 1.65], [5200, .26, .43, 1.65]],
    events: [event(300, 'jump-review', () => { byId('terminal-tab').textContent = 'demo-ssh · workspace'; terminal(['', '', '', ''], 'TMUX / workspace / UTF-8'); typeInto('terminal-line-0', '$ ssh demo-dev', 650); typeInto('terminal-line-1', '$ tmux -u a -t workspace', 950, 700); typeInto('terminal-line-3', '✓ 已进入工作区 · 中文显示正常', 800, 1800); }), event(4100, 'terminal-tab', () => banner('工作在继续，你已回到现场。'))],
  },
  {
    label: '复用', title: '不是重新开始。是接着上次。', description: '再次点击同一入口，只定位已有终端，不重复执行。', duration: 5500, connected: true,
    shots: [[0, .5, .5, 1], [1000, .78, .58, 1.6], [2500, .27, .55, 1.65], [4400, .5, .5, 1]],
    events: [event(500, 'jump-review', () => banner('↗ 已定位 · 没有发送新命令')), event(3300, 'terminal-tab', () => toast('同一任务，同一个工作现场。'))],
  },
  {
    label: '带走', title: '把工作整理好，也把记录带走。', description: '任务树 → 层级 Markdown。分享阅读版，保留 ID 后再编辑回导。', duration: 7500, connected: true,
    shots: [[0, .5, .5, 1], [700, .73, .82, 1.4], [2100, .5, .5, 1]],
    events: [event(400, 'export-button', () => { byId('comparison').hidden = false; })],
  },
];
const clipDefinitions = [
  { id: 'organize', title: '层级与记录', subtitle: '细分、移动、留下结论', labels: ['编辑与移动层级', '记录与完成状态'], glyph: '▤', focus: [.77, .56, 1.5] },
  { id: 'ssh', title: 'SSH 与 tmux', subtitle: '选择主机，准备会话', labels: ['SSH 选择与关联', 'window 与自动创建'], glyph: '⌁', focus: [.5, .5, 1.15] },
  { id: 'reuse', title: '打开与复用', subtitle: '一次打开，随时回去', labels: ['保存与首次打开', '再次点击与复用'], glyph: '↗', focus: [.28, .5, 1.5] },
  { id: 'markdown', title: 'Markdown 往返', subtitle: '导出阅读，预览回导', labels: ['Markdown 导出', 'Markdown 导入'], glyph: 'M↓', focus: [.5, .5, 1.1] },
  { id: 'commands', title: '命令与笔记', subtitle: '编辑入口，从笔记跳转', labels: ['终端编辑与本地脚本', '笔记 URL 与 V1'], glyph: '›_', focus: [.5, .5, 1.13] },
  { id: 'delete', title: '安全删除', subtitle: '看清范围，保留远端工作', labels: ['删除节点与子树', '删除终端入口'], glyph: '−', focus: [.5, .5, 1.15] },
];
let scenes = [];
let totalDuration = 0;

function selectClip(identifier, autoplay = true) {
  const clip = clipDefinitions.find(entry => entry.id === identifier);
  activeClip = clip ? clip.id : 'main';
  const source = clip ? clip.labels.map(label => libraryScenes.find(scene => scene.label === label)) : heroScenes;
  totalDuration = 0;
  scenes = source.map(scene => {
    const entry = { ...scene, start: totalDuration, connected: scene.connected ?? Boolean(clip), shots: scene.shots || [[0, .5, .5, 1], [1200, ...clip.focus], [scene.duration - 600, .5, .5, 1]] };
    totalDuration += scene.duration;
    return entry;
  });
  byId('chapter-list').replaceChildren();
  scenes.forEach((scene, index) => {
    const button = element('button');
    button.type = 'button';
    button.dataset.chapter = String(index);
    button.append(element('span', '', String(index + 1).padStart(2, '0')), document.createTextNode(scene.label));
    button.addEventListener('click', () => seekTo(scene.start));
    byId('chapter-list').append(button);
  });
  byId('duration').textContent = formatTime(totalDuration);
  byId('film-name').textContent = clip ? clip.title + ' / SHORT FILM' : 'THE WORKFLOW / 32s';
  byId('back-main').hidden = !clip;
  document.querySelectorAll('[data-clip]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.clip === activeClip)));
  byId('cinema').dataset.clip = activeClip;
  seekTo(0);
  setPlaying(autoplay && !reducedMotion.matches);
}

function baseScene(index) {
  typingTracks = [];
  targetCache = new Map();
  closeModal();
  byId('comparison').hidden = true;
  byId('cursor').style.opacity = '1';
  byId('scene-toast').hidden = true;
  byId('terminal-banner').hidden = true;
  byId('notes-panel').hidden = true;
  byId('note-content').textContent = '';
  byId('note-input').textContent = '记录结论与下一步…';
  byId('search-box').textContent = '⌕ 搜索任意层级或记录';
  byId('status-filter').textContent = '未完成 ⌄';
  byId('commands-tab').querySelector('b').textContent = '2';
  const connected = Boolean(scenes[index].connected);
  byId('terminal-tab').textContent = connected ? 'demo-ssh · 远端工作区' : 'zsh — 工作终端';
  rows();
  terminal(connected
    ? ['$ tmux -u a -t workspace', '', '[workspace] 正在继续工作', '✓ 环境检查完成', '✓ 中文输出正常', '', '等待下一步…']
    : ['Terminal Workspace', '', '你的终端在这里。', '任务在右边。', '', '从一个节点，回到工作现场。'], connected ? 'TMUX / workspace / UTF-8' : 'LOCAL / READY');
}

function sceneAt(time) {
  return Math.max(0, scenes.findIndex(scene => time < scene.start + scene.duration));
}

function resetScene(index) {
  activeScene = index;
  eventCount = 0;
  localTime = 0;
  modalOpened = -1000;
  cursorPosition = { x: stage.clientWidth * .55, y: stage.clientHeight * .8 };
  baseScene(index);
  const scene = scenes[index];
  if (scene.setup) scene.setup();
  byId('scene-number').textContent = String(index + 1).padStart(2, '0');
  byId('scene-title').textContent = scene.title;
  byId('scene-description').textContent = scene.description;
  stage.dataset.scene = String(index);
  byId('shot-label').textContent = `${String(index + 1).padStart(2, '0')} / ${scene.label}`;
  document.querySelectorAll('[data-chapter]').forEach(button => {
    if (Number(button.dataset.chapter) === index) {
      button.setAttribute('aria-current', 'step');
      const list = byId('chapter-list');
      if (list.scrollWidth > list.clientWidth) list.scrollLeft = button.offsetLeft - list.offsetLeft - 10;
    } else button.removeAttribute('aria-current');
  });
}

function targetPoint(identifier) {
  const target = byId(identifier);
  if (target && target.getClientRects().length) {
    const bounds = target.getBoundingClientRect();
    const parent = camera.getBoundingClientRect();
    const point = { x: Math.max(8, Math.min(stage.clientWidth - 26, (bounds.left - parent.left + bounds.width * .58) / cameraScale)), y: Math.max(32, Math.min(stage.clientHeight - 32, (bounds.top - parent.top + bounds.height * .55) / cameraScale)) };
    targetCache.set(identifier, point);
    return point;
  }
  return targetCache.get(identifier) || { x: stage.clientWidth * .7, y: stage.clientHeight * .62 };
}

function drawCursor(scene, time) {
  let previousPoint = { x: stage.clientWidth * .55, y: stage.clientHeight * .8 };
  let ringEvent = null;
  for (const action of scene.events) {
    if (time < action.at) break;
    const point = targetPoint(action.target);
    const progress = reducedMotion.matches ? 1 : clamp((time - action.at) / 600);
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    cursorPosition = { x: previousPoint.x + (point.x - previousPoint.x) * eased, y: previousPoint.y + (point.y - previousPoint.y) * eased };
    previousPoint = point;
    if (time >= action.clickAt && time < action.clickAt + 480) ringEvent = { point, phase: (time - action.clickAt) / 480 };
  }
  byId('cursor').style.transform = `translate(${cursorPosition.x}px, ${cursorPosition.y}px)`;
  const ring = byId('click-ring');
  ring.style.opacity = ringEvent && !reducedMotion.matches ? String(1 - ringEvent.phase) : '0';
  if (ringEvent) ring.style.transform = `translate(${ringEvent.point.x - 17}px, ${ringEvent.point.y - 17}px) scale(${.55 + ringEvent.phase * 1.1})`;
}

function render(force = false) {
  const index = sceneAt(position);
  if (force || index !== activeScene) resetScene(index);
  const scene = scenes[index];
  const time = position - scene.start;
  while (eventCount < scene.events.length && scene.events[eventCount].clickAt <= time) {
    const action = scene.events[eventCount];
    localTime = action.clickAt;
    drawTyping(localTime);
    targetPoint(action.target);
    action.run();
    eventCount += 1;
  }
  localTime = time;
  drawTyping(time);
  if (!byId('modal-layer').hidden) {
    const progress = reducedMotion.matches ? 1 : clamp((time - modalOpened) / 260);
    byId('modal').style.opacity = String(progress);
    byId('modal').style.transform = `translateY(${(1 - progress) * 12}px) scale(${.96 + progress * .04})`;
  }
  drawCamera(scene, time);
  drawCursor(scene, time);
  drawComparison(time);
  byId('seek').value = String(Math.round(position / totalDuration * 1000));
  byId('seek').setAttribute('aria-valuetext', `${formatTime(position)}，${scene.title}`);
  byId('elapsed').textContent = formatTime(position);
}

function drawCamera(scene, time) {
  const shots = scene.shots;
  let first = shots[0];
  let second = shots[shots.length - 1];
  for (let index = 0; index < shots.length - 1; index += 1) {
    if (time >= shots[index][0]) { first = shots[index]; second = shots[index + 1]; }
    if (time < shots[index + 1][0]) break;
  }
  const progress = clamp((time - first[0]) / Math.max(1, second[0] - first[0]));
  const eased = progress * progress * (3 - 2 * progress);
  let anchorX = first[1] + (second[1] - first[1]) * eased;
  let anchorY = first[2] + (second[2] - first[2]) * eased;
  const limit = window.innerWidth < 520 ? 1.35 : 1.85;
  cameraScale = reducedMotion.matches ? 1 : Math.min(limit, first[3] + (second[3] - first[3]) * eased);
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!byId('modal-layer').hidden) {
    const modal = byId('modal');
    const fit = Math.min((width - 22) / modal.offsetWidth, (height - 35) / modal.offsetHeight);
    cameraScale = Math.max(1, Math.min(cameraScale, fit));
    anchorX = .5;
    anchorY = .53;
  }
  const translateX = Math.max(width * (1 - cameraScale), Math.min(0, width * (.5 - anchorX * cameraScale)));
  const translateY = Math.max(height * (1 - cameraScale), Math.min(0, height * (.5 - anchorY * cameraScale)));
  camera.style.transform = `translate(${translateX}px, ${translateY}px) scale(${cameraScale})`;
  stage.dataset.zoom = cameraScale.toFixed(3);
}

function drawComparison(time) {
  if (byId('comparison').hidden) return;
  const progress = reducedMotion.matches ? 1 : clamp((time - 1000) / 650);
  byId('comparison').style.opacity = String(progress);
  const before = byId('comparison').querySelector('.compare-before');
  const after = byId('comparison').querySelector('.compare-after');
  const arrival = reducedMotion.matches ? 1 : clamp((time - 1700) / 1100);
  const eased = 1 - (1 - arrival) ** 3;
  before.style.transform = `translateX(${(1 - progress) * 45}px)`;
  after.style.opacity = String(eased);
  after.style.transform = `translate(${(1 - eased) * -50}px, ${(1 - eased) * 18}px) scale(${.92 + .08 * eased})`;
  byId('cursor').style.opacity = '0';
}

function formatTime(time) {
  const seconds = Math.floor(time / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateControls() {
  byId('play-toggle').textContent = playing ? 'Ⅱ' : '▶';
  byId('play-toggle').setAttribute('aria-label', playing ? '暂停演示' : '播放演示');
  byId('playing-status').textContent = playing ? '自动播放' : '已暂停';
  byId('cinema').dataset.playing = String(playing);
}

function tick(timestamp) {
  if (!playing) return;
  if (!lastFrame) lastFrame = timestamp;
  const delta = timestamp - lastFrame;
  lastFrame = timestamp;
  position += delta * speed;
  if (position >= totalDuration) { position %= totalDuration; activeScene = -1; }
  render();
  frameHandle = requestAnimationFrame(tick);
}

function setPlaying(value) {
  playing = value;
  cancelAnimationFrame(frameHandle);
  lastFrame = 0;
  updateControls();
  if (playing && !document.hidden) frameHandle = requestAnimationFrame(tick);
}

function seekTo(time) {
  position = Math.max(0, Math.min(totalDuration - 1, time));
  lastFrame = 0;
  render(true);
}

function chapterJump(direction) {
  const index = Math.max(0, Math.min(scenes.length - 1, activeScene + direction));
  seekTo(scenes[index].start);
}

clipDefinitions.forEach(clip => {
  const button = element('button', 'short-card');
  button.type = 'button';
  button.dataset.clip = clip.id;
  const duration = clip.labels.reduce((sum, label) => sum + libraryScenes.find(scene => scene.label === label).duration, 0);
  const heading = element('span');
  heading.append(element('span', '', clip.glyph), element('span', '', `${Math.round(duration / 1000)}s ↗`));
  button.append(heading, element('strong', '', clip.title), element('small', '', clip.subtitle));
  button.addEventListener('click', () => {
    selectClip(clip.id);
    byId('cinema').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });
  byId('short-list').append(button);
});
byId('back-main').addEventListener('click', () => selectClip('main'));
byId('play-toggle').addEventListener('click', () => setPlaying(!playing));
byId('previous').addEventListener('click', () => chapterJump(-1));
byId('next').addEventListener('click', () => chapterJump(1));
byId('replay').addEventListener('click', () => { seekTo(0); setPlaying(true); });
byId('seek').addEventListener('input', event => seekTo(Number(event.target.value) / 1000 * totalDuration));
byId('speed').addEventListener('change', event => { speed = Number(event.target.value); lastFrame = 0; });
byId('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (byId('cinema').requestFullscreen) await byId('cinema').requestFullscreen();
    else throw new Error('Fullscreen unavailable');
  } catch { byId('motion-note').textContent = '此浏览器不支持网页全屏；可使用浏览器菜单放大观看。'; byId('motion-note').hidden = false; }
});
document.addEventListener('keydown', event => {
  if (event.target.closest('input, select, button, a') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Space') { event.preventDefault(); setPlaying(!playing); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); chapterJump(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); chapterJump(1); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { resumeAfterVisibility = playing; setPlaying(false); }
  else if (resumeAfterVisibility) { resumeAfterVisibility = false; setPlaying(true); }
});
reducedMotion.addEventListener('change', () => {
  byId('motion-note').hidden = !reducedMotion.matches;
  if (reducedMotion.matches) setPlaying(false);
  render();
});
window.addEventListener('resize', () => render(true));
byId('motion-note').hidden = !reducedMotion.matches;
byId('speed').value = '1.5';
selectClip('main');
