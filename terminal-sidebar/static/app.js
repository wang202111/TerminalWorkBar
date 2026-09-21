'use strict';

const token = location.pathname.split('/')[2];
let state = { tasks: [], commands: [], revision: 0, command_revision: '' };
function remembered(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch { return new Set(); }
}
const expanded = remembered('terminal-sidebar-notes');
const branches = remembered('terminal-sidebar-branches');
function remember() {
  try {
    localStorage.setItem('terminal-sidebar-notes', JSON.stringify([...expanded]));
    localStorage.setItem('terminal-sidebar-branches', JSON.stringify([...branches]));
  } catch {}
}
const drafts = new Map();
let pendingCreate = null;
let associateCommand = false;
let markdownPreview = null;
let exportDraft = null;
let exportRequest = 0;
let tmuxRequest = 0;
let commandEditRevision = '';
let pendingDeleteCommand = null;
let pendingDeleteTask = null;
let sshHostsRequest = 0;
let pendingNoteEdit = null;
const byId = id => document.getElementById(id);

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function noteTime(entry) {
  for (const value of [entry.updated, entry.created]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function editNote(task, entry) {
  pendingNoteEdit = { id: task.id, note_id: entry.id, revision: state.revision };
  const form = byId('note-edit-form');
  form.elements.note.value = entry.text;
  form.querySelector('.form-error').textContent = '';
  byId('note-edit-context').textContent = task.title + ' · 创建于 ' + new Date(entry.created).toLocaleString('zh-CN');
  byId('note-edit-dialog').showModal();
  form.elements.note.focus();
}

function button(label, action, className = '') {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', () => action(element));
  return element;
}

function notify(message, error = false) {
  byId('notice').textContent = message;
  byId('notice').classList.toggle('error', error);
}

async function api(action, payload) {
  const response = await fetch('/api/' + action, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'X-Sidebar-Token': token, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}

async function run(action, payload = {}, element) {
  if (element) element.disabled = true;
  try {
    const result = await api(action, { revision: state.revision, ...payload });
    if (result.tasks) { state = result; render(); }
    if (result.message) notify(result.message + (result.path ? '\n' + result.path : ''));
    return result;
  } catch (error) {
    notify(error.message, true);
    throw error;
  } finally {
    if (element) element.disabled = false;
  }
}

function safely(promise) { promise.catch(() => {}); }

async function refresh() {
  try {
    state = await api('state');
    render();
    notify('本地工作台已就绪。保存不执行；记录与第一版分开存放。');
  } catch (error) { notify('无法加载：' + error.message + '。请重新打开 Terminal Sidebar.app。', true); }
}

async function copyLink(commandId, title, element) {
  const link = `terminal-jump://open/${commandId}`;
  const label = title.replace(/([\\\[\]])/g, '\\$1').replace(/\n/g, ' ');
  const content = `[${label}](${link})`;
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(content);
  } catch {
    const area = node('textarea');
    area.value = content;
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) { notify('请手动复制：' + content); return; }
  }
  notify('已复制 Markdown 链接，可粘贴到 Obsidian。');
}

function commandOptions(selected = '') {
  const select = byId('task-form').elements.command_id;
  select.replaceChildren(new Option('暂不关联', ''));
  for (const command of state.commands) select.add(new Option(command.title, command.id));
  if (selected && !state.commands.some(command => command.id === selected)) select.add(new Option(selected + '（配置已删除）', selected));
  select.value = selected;
}

function treeIndex() {
  const nodes = new Map(state.tasks.map(task => [task.id, task]));
  const children = new Map();
  for (const task of state.tasks) {
    const parent = task.parent_id || '';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(task);
  }
  const rows = [];
  const pending = [...(children.get('') || [])].reverse().map(task => ({ task, ancestors: [] }));
  while (pending.length) {
    const row = pending.pop();
    rows.push(row);
    for (const child of [...(children.get(row.task.id) || [])].reverse()) pending.push({ task: child, ancestors: [...row.ancestors, row.task] });
  }
  return { nodes, children, rows };
}

function editTask(task, parentId = '') {
  const form = byId('task-form');
  form.reset();
  byId('association-hint').textContent = '没有合适的入口？直接新建，保存后回到这里，无需切换到终端页。';
  form.elements.id.value = task?.id || '';
  byId('delete-task-editor').hidden = !task;
  form.elements.title.value = task?.title || '';
  form.elements.kind.value = task?.kind || 'task';
  const parentSelect = form.elements.parent_id;
  parentSelect.replaceChildren(new Option('顶层（无上级）', ''));
  for (const row of treeIndex().rows) {
    if (task && (row.task.id === task.id || row.ancestors.some(ancestor => ancestor.id === task.id))) continue;
    parentSelect.add(new Option([...row.ancestors, row.task].map(entry => entry.title).join(' / '), row.task.id));
  }
  parentSelect.value = task?.parent_id || parentId;
  commandOptions(task?.command_id || '');
  form.querySelector('.form-error').textContent = '';
  byId('task-heading').textContent = task ? '编辑节点 / 移动层级' : parentId ? '添加子级' : '添加顶层节点';
  byId('task-dialog').showModal();
}

function taskCard(task, ancestors, children, isOpen, forced) {
  const isGroup = task.kind === 'group';
  const card = node('article', 'task level-' + Math.min(ancestors.length, 4) + (task.done && !isGroup ? ' done' : '') + (isGroup ? ' directory' : ''));
  card.dataset.nodeId = task.id;
  card.dataset.depth = ancestors.length;
  const top = node('div', 'task-top');
  if (children.length) {
    const toggle = button(isOpen ? '▾' : '▸', () => {
      if (forced) { notify('搜索或已完成筛选时自动展开祖先层级；清除筛选后可以手动收起。'); return; }
      branches.has(task.id) ? branches.delete(task.id) : branches.add(task.id);
      remember(); render();
    }, 'tree-toggle');
    toggle.setAttribute('aria-label', (isOpen ? '收起：' : '展开：') + task.title);
    toggle.setAttribute('aria-expanded', String(isOpen));
    top.append(toggle);
  } else top.append(node('span', 'tree-leaf', '·'));
  if (isGroup) top.append(node('span', 'folder-icon', '▣'));
  else {
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', '完成任务：' + task.title);
    checkbox.addEventListener('change', () => safely(run('complete', { id: task.id, done: checkbox.checked }, checkbox).catch(error => { checkbox.checked = task.done; throw error; })));
    top.append(checkbox);
  }
  const label = node('span', 'task-title', task.title);
  label.title = [...ancestors, task].map(entry => entry.title).join(' / ');
  top.append(label);
  if (children.length) top.append(node('span', 'child-count', children.length));
  top.append(button('设置', () => editTask(task), 'plain'));
  card.append(top);
  if (ancestors.length > 3) card.append(node('p', 'deep-path', `第 ${ancestors.length + 1} 级 · ` + ancestors.map(entry => entry.title).join(' / ')));
  const actions = node('div', 'task-actions');
  const command = state.commands.find(entry => entry.id === task.command_id);
  if (command) {
    actions.append(button('›_ ' + command.title, element => safely(run('open', { command_id: command.id }, element)), 'open-terminal'));
    actions.append(button('复制链接', element => safely(copyLink(command.id, task.title, element)), 'plain'));
  } else {
    actions.append(button(task.command_id ? '入口失效 · 重新关联' : '＋ 关联终端', () => editTask(task), 'plain'));
  }
  actions.append(button('＋ 子级', () => editTask(null, task.id), 'plain'));
  const remove = button('删除', () => deleteTask(task), 'plain danger');
  remove.setAttribute('aria-label', '删除节点：' + task.title);
  actions.append(remove);
  card.append(actions);
  const details = node('details');
  details.open = expanded.has(task.id);
  details.addEventListener('toggle', () => { if (!details.isConnected) return; details.open ? expanded.add(task.id) : expanded.delete(task.id); remember(); });
  details.append(node('summary', '', `工作记录 · ${task.notes.length} 条`));
  const notes = node('div', 'notes');
  if (!task.notes.length) notes.append(node('p', 'note-empty', '记录结论、下一步或遇到的问题。'));
  for (const entry of [...task.notes].sort((first, second) => noteTime(second) - noteTime(first))) {
    const note = node('div', 'note');
    note.dataset.noteId = entry.id;
    const heading = node('div', 'note-heading');
    const timestamp = node('time', '', (entry.updated ? '更新于 ' : '') + new Date(noteTime(entry)).toLocaleString('zh-CN'));
    timestamp.title = '创建于 ' + new Date(entry.created).toLocaleString('zh-CN');
    heading.append(timestamp, button('编辑', () => editNote(task, entry), 'plain'));
    note.append(heading, node('p', '', entry.text));
    notes.append(note);
  }
  const form = node('form', 'note-form');
  const textarea = node('textarea');
  textarea.placeholder = '补充一条工作记录…';
  textarea.rows = 3;
  textarea.maxLength = 20000;
  textarea.required = true;
  textarea.value = drafts.get(task.id) || '';
  textarea.addEventListener('input', () => drafts.set(task.id, textarea.value));
  const save = node('button', '', '添加记录');
  save.type = 'submit';
  form.append(textarea, save);
  form.addEventListener('submit', event => {
    event.preventDefault();
    expanded.add(task.id);
    safely(run('note', { id: task.id, note: textarea.value }, save).then(() => { drafts.delete(task.id); render(); }));
  });
  details.append(notes, form);
  card.append(details);
  return card;
}

function render() {
  byId('task-count').textContent = state.tasks.filter(task => task.kind !== 'group' && !task.done).length;
  byId('command-count').textContent = state.commands.length;
  const search = byId('search').value.trim().toLocaleLowerCase();
  const filter = byId('filter').value;
  const tree = treeIndex();
  const included = new Set();
  const forced = Boolean(search) || filter === 'done';
  for (const {task, ancestors} of tree.rows) {
    if (filter === 'active' && task.done && task.kind !== 'group' || filter === 'done' && (!task.done || task.kind === 'group')) continue;
    if (![...ancestors.map(entry => entry.title), task.title, ...task.notes.map(entry => entry.text)].join('\n').toLocaleLowerCase().includes(search)) continue;
    included.add(task.id);
    for (const ancestor of ancestors) included.add(ancestor.id);
  }
  byId('tasks').replaceChildren();
  let visibleCount = 0;
  for (const {task, ancestors} of tree.rows) {
    if (!included.has(task.id) || !forced && ancestors.some(ancestor => !branches.has(ancestor.id))) continue;
    const children = tree.children.get(task.id) || [];
    byId('tasks').append(taskCard(task, ancestors, children, forced || branches.has(task.id), forced));
    visibleCount += 1;
  }
  byId('tree-count').textContent = `${visibleCount} / ${state.tasks.length} 个节点`;
  byId('empty').hidden = visibleCount > 0;
  byId('commands').replaceChildren();
  for (const command of state.commands) {
    const card = node('article', 'command-card');
    card.append(node('strong', '', command.title), node('code', '', `terminal-jump://open/${command.id}`));
    const row = node('div', 'row');
    row.append(button('打开终端', element => safely(run('open', { command_id: command.id }, element)), 'open-terminal'), button('复制链接', element => safely(copyLink(command.id, command.title, element))));
    row.append(button('编辑', () => openCommandEditor(false, command)), button('删除', () => deleteCommand(command)));
    const details = node('details');
    details.append(node('summary', '', '查看命令'), node('pre', '', (command.mode === 'ssh' ? `SSH ${command.host}\n` : '') + command.command));
    card.append(row, details);
    byId('commands').append(card);
  }
}

function switchTab(tab) {
  for (const name of ['tasks', 'commands']) {
    byId(name + '-view').hidden = name !== tab;
    byId('tab-' + name).classList.toggle('active', name === tab);
  }
}

function modeChanged() {
  const mode = byId('command-form').elements.mode.value;
  byId('tmux-fields').hidden = mode !== 'tmux';
  byId('script-fields').hidden = mode === 'tmux';
  byId('host-fields').hidden = mode === 'shell';
  if (mode !== 'shell') safely(loadSshHosts());
}

async function loadSshHosts() {
  const request = ++sshHostsRequest;
  const select = byId('ssh-host-select');
  const trigger = byId('ssh-host-refresh');
  trigger.disabled = true;
  select.disabled = true;
  byId('ssh-host-status').textContent = '正在读取本机 ~/.ssh/config 和 Include 文件…';
  try {
    const result = await api('ssh_hosts', {});
    if (request !== sshHostsRequest) return;
    select.replaceChildren(new Option('选择配置别名（也可在下面手动输入）', ''), ...result.hosts.map(host => new Option(host, host)));
    const current = byId('command-form').elements.host.value.trim();
    select.value = result.hosts.includes(current) ? current : '';
    select.disabled = result.hosts.length === 0;
    byId('ssh-host-status').textContent = [result.message, ...result.warnings].join('\n');
  } catch (error) {
    if (request !== sshHostsRequest) return;
    select.replaceChildren(new Option('读取失败，请手动输入 SSH 主机', ''));
    byId('ssh-host-status').textContent = error.message;
  } finally {
    if (request === sshHostsRequest) trigger.disabled = false;
  }
}

function openCommandEditor(associate = false, command = null) {
  associateCommand = associate;
  commandEditRevision = state.command_revision;
  const form = byId('command-form');
  form.reset();
  if (associate) form.elements.title.value = byId('task-form').elements.title.value;
  form.elements.original_id.value = command?.id || '';
  form.elements.id.readOnly = Boolean(command);
  if (command) {
    for (const key of ['id', 'title', 'host', 'command', 'cwd', 'mode']) form.elements[key].value = command[key] || '';
    if (command.tmux) {
      form.elements.mode.value = 'tmux';
      form.elements.session.value = command.tmux.session;
      form.elements.window.value = command.tmux.window;
      form.elements.create_on_open.checked = command.tmux.create_on_open;
    }
  }
  byId('command-heading').textContent = command ? '编辑终端入口' : '添加终端入口';
  form.querySelector('.form-error').textContent = '';
  form.querySelector('[type=submit]').textContent = associate ? '保存入口并选中，返回任务' : command ? '保存修改，不执行' : '保存入口，不执行';
  byId('sessions').replaceChildren();
  byId('session-list').replaceChildren();
  resetTmux();
  modeChanged();
  byId('command-dialog').showModal();
}

function deleteCommand(command) {
  pendingDeleteCommand = { id: command.id, command_revision: state.command_revision };
  const linked = treeIndex().rows.filter(row => row.task.command_id === command.id);
  byId('delete-command-title').textContent = `${command.title}（${command.id}）`;
  byId('delete-command-count').textContent = `当前有 ${linked.length} 个节点关联此入口，删除后它们会显示「入口失效 · 重新关联」。`;
  byId('delete-command-tasks').replaceChildren(...linked.map(row => node('li', '', [...row.ancestors, row.task].map(entry => entry.title).join(' / '))));
  byId('delete-command-error').textContent = '';
  byId('delete-command-dialog').showModal();
}

function deleteTask(task) {
  const tree = treeIndex();
  const rows = tree.rows.filter(row => row.task.id === task.id || row.ancestors.some(ancestor => ancestor.id === task.id));
  pendingDeleteTask = { id: task.id, revision: state.revision, rows, childCount: (tree.children.get(task.id) || []).length };
  byId('delete-task-title').textContent = (rows[0]?.ancestors || []).map(entry => entry.title).concat(task.title).join(' / ');
  byId('delete-task-scope').value = 'node';
  byId('delete-task-scope-label').hidden = rows.length === 1;
  byId('delete-task-error').textContent = '';
  renderDeleteTask();
  byId('delete-task-dialog').showModal();
}

function renderDeleteTask() {
  if (!pendingDeleteTask) return;
  const all = byId('delete-task-scope').value === 'subtree';
  const affected = all ? pendingDeleteTask.rows : pendingDeleteTask.rows.slice(0, 1);
  const notes = affected.reduce((count, row) => count + row.task.notes.length, 0);
  const retained = pendingDeleteTask.rows.length - affected.length;
  byId('delete-task-impact').textContent = `将删除 ${affected.length} 个节点及 ${notes} 条记录。` + (retained ? `保留 ${retained} 个后代节点，其中 ${pendingDeleteTask.childCount} 个直接子级移到原节点的上级。` : '');
  byId('delete-task-list').replaceChildren(...affected.map(row => node('li', '', [...row.ancestors, row.task].map(entry => entry.title).join(' / '))));
  byId('delete-task-confirm').textContent = `确认删除 ${affected.length} 个节点`;
}

function invalidateMarkdown() {
  markdownPreview = null;
  byId('markdown-apply').disabled = true;
  byId('markdown-preview-result').replaceChildren();
  byId('markdown-error').textContent = '';
}

function openMarkdown() {
  invalidateMarkdown();
  byId('markdown-dialog').showModal();
}

function resetTmux() {
  tmuxRequest += 1;
  byId('sessions').replaceChildren();
  byId('session-list').replaceChildren();
  byId('tmux-status').textContent = '查询当前 SSH 主机的默认 tmux session，不会自动连接或创建。';
  byId('tmux-status').className = 'hint';
  byId('list-tmux').disabled = false;
  byId('list-tmux').textContent = '查询远端';
}

function exportBusy(busy) {
  for (const identifier of ['export-save-as', 'export-save-default', 'export-copy']) byId(identifier).disabled = busy || !exportDraft;
  byId('export-format').disabled = busy;
}

function renderExport(outline) {
  const root = node('ul');
  const lists = [root];
  const items = [];
  for (const entry of outline) {
    const depth = entry.depth;
    if (!lists[depth]) { lists[depth] = node('ul'); items[depth - 1].append(lists[depth]); }
    lists.length = depth + 1;
    const item = node('li');
    item.append(node(entry.kind === 'group' ? 'strong' : 'span', '', (entry.kind === 'group' ? '' : entry.done ? '☑ ' : '☐ ') + entry.title));
    if (entry.command_id) item.append(node('span', 'export-terminal', '终端 · ' + entry.command_id));
    for (const note of entry.notes || []) item.append(node('blockquote', '', note.text));
    lists[depth].append(item);
    items[depth] = item;
    items.length = depth + 1;
  }
  byId('export-preview').replaceChildren(node('h3', '', '工作清单'), root);
  if (!outline.length) byId('export-preview').append(node('p', 'hint', '还没有任务。'));
}

async function prepareExport() {
  const request = ++exportRequest;
  exportDraft = null;
  exportBusy(true);
  byId('export-path').textContent = '';
  byId('export-message').textContent = '正在生成预览，尚未保存文件…';
  byId('export-content').value = '';
  byId('export-preview').replaceChildren();
  const format = byId('export-format').value;
  byId('export-hint').textContent = format === 'pretty'
    ? '标准嵌套列表、加粗目录、任务勾选和引用记录，没有 ID / JSON 注释。适合阅读和分享；重新导入按名称路径匹配，改名或移动可能新增节点。'
    : '保留稳定 ID、类型和记录时间，适合改名、移动后重新导入。ID 在 Markdown 阅读模式隐藏，源码仍包含元数据注释。';
  try {
    const result = await api('export_preview', { format });
    if (request !== exportRequest) return;
    exportDraft = result;
    renderExport(result.outline);
    byId('export-content').value = result.markdown;
    byId('export-message').textContent = '预览已就绪。可选择文件名和位置，或保存到 vault 的 terminal-sidebar/exports/。已有文件不会被覆盖。';
  } catch (error) { byId('export-message').textContent = error.message; }
  finally { if (request === exportRequest) exportBusy(false); }
}

async function saveExport(destination) {
  if (!exportDraft) return;
  exportBusy(true);
  byId('export-message').textContent = destination === 'choose' ? '请在 macOS 保存对话框中选择文件名和目录；也可以取消。' : '正在保存…';
  try {
    const result = await api('export', { format: exportDraft.format, revision: exportDraft.revision, destination });
    if (!result.cancelled) byId('export-path').textContent = result.path;
    byId('export-message').textContent = result.message;
    notify(result.message);
  } catch (error) { byId('export-message').textContent = error.message; }
  finally { exportBusy(false); }
}

byId('tab-tasks').addEventListener('click', () => switchTab('tasks'));
byId('tab-commands').addEventListener('click', () => switchTab('commands'));
byId('new-task').addEventListener('click', () => editTask());
byId('delete-task-editor').addEventListener('click', () => {
  const task = state.tasks.find(entry => entry.id === byId('task-form').elements.id.value);
  if (task) deleteTask(task);
});
byId('delete-task-scope').addEventListener('change', renderDeleteTask);
byId('delete-task-dialog').addEventListener('close', () => { pendingDeleteTask = null; });
byId('delete-task-confirm').addEventListener('click', async event => {
  const pending = pendingDeleteTask;
  if (!pending) return;
  try {
    await run('task_delete', { id: pending.id, revision: pending.revision, scope: byId('delete-task-scope').value, confirmed: true }, event.currentTarget);
    const liveIds = new Set(state.tasks.map(task => task.id));
    for (const identifier of expanded) if (!liveIds.has(identifier)) expanded.delete(identifier);
    for (const identifier of branches) if (!liveIds.has(identifier)) branches.delete(identifier);
    for (const identifier of drafts.keys()) if (!liveIds.has(identifier)) drafts.delete(identifier);
    if (byId('task-dialog').open && !liveIds.has(byId('task-form').elements.id.value)) byId('task-dialog').close();
    byId('delete-task-dialog').close();
    remember();
    render();
  } catch (error) { byId('delete-task-error').textContent = error.message + ' 请取消并刷新后重新确认。'; }
});
byId('refresh').addEventListener('click', refresh);
byId('search').addEventListener('input', render);
byId('filter').addEventListener('change', render);
byId('expand-all').addEventListener('click', () => { for (const task of state.tasks) branches.add(task.id); remember(); render(); });
byId('collapse-all').addEventListener('click', () => {
  branches.clear(); expanded.clear(); byId('search').value = ''; byId('filter').value = 'active'; remember(); render();
});
byId('new-command').addEventListener('click', () => openCommandEditor());
byId('associate-new-command').addEventListener('click', () => openCommandEditor(true));
byId('associate-edit-command').addEventListener('click', () => {
  const command = state.commands.find(entry => entry.id === byId('task-form').elements.command_id.value);
  if (command) openCommandEditor(true, command);
  else byId('association-hint').textContent = '请先选择一个有效的终端入口，或直接新建。';
});
byId('delete-command-confirm').addEventListener('click', async event => {
  if (!pendingDeleteCommand) return;
  try {
    await run('command_delete', { ...pendingDeleteCommand, confirmed: true }, event.currentTarget);
    pendingDeleteCommand = null;
    byId('delete-command-dialog').close();
  } catch (error) { byId('delete-command-error').textContent = error.message; }
});
byId('command-form').elements.mode.addEventListener('change', modeChanged);
for (const element of document.querySelectorAll('[data-close]')) element.addEventListener('click', () => byId(element.dataset.close).close());
for (const identifier of ['import', 'import-empty']) byId(identifier).addEventListener('click', openMarkdown);
byId('export').addEventListener('click', () => {
  byId('export-dialog').showModal();
  safely(prepareExport());
});
byId('export-format').addEventListener('change', () => safely(prepareExport()));
byId('export-save-as').addEventListener('click', () => safely(saveExport('choose')));
byId('export-save-default').addEventListener('click', () => safely(saveExport('vault')));
byId('export-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(byId('export-content').value);
    byId('export-message').textContent = '已复制。';
  } catch {
    byId('export-content').closest('details').open = true;
    byId('export-content').focus();
    byId('export-content').select();
    byId('export-message').textContent = document.execCommand('copy') ? '已复制。' : '请按 ⌘C 复制已选中的内容。';
  }
});
byId('markdown-input').addEventListener('input', invalidateMarkdown);
byId('markdown-file').addEventListener('change', async event => {
  invalidateMarkdown();
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 240000) throw new Error('文件过大，请拆分为小于 240 KB 的 Markdown。');
    byId('markdown-input').value = await file.text();
    invalidateMarkdown();
  } catch (error) { byId('markdown-error').textContent = error.message; }
});
byId('markdown-todo').addEventListener('click', async event => {
  try {
    const result = await run('markdown_source', {}, event.currentTarget);
    byId('markdown-input').value = result.markdown;
    invalidateMarkdown();
  } catch (error) { byId('markdown-error').textContent = error.message; }
});
byId('markdown-preview').addEventListener('click', async event => {
  invalidateMarkdown();
  const source = byId('markdown-input').value;
  try {
    if (new TextEncoder().encode(JSON.stringify({ markdown: source })).length > 250000) throw new Error('内容过大，请拆分后导入。');
    const result = await run('markdown_preview', { markdown: source }, event.currentTarget);
    if (source !== byId('markdown-input').value || !byId('markdown-dialog').open) return;
    markdownPreview = { ...result, source };
    const output = byId('markdown-preview-result');
    const counts = result.counts;
    output.append(node('p', '', `新增 ${counts.added} · 更新 ${counts.updated} · 未变 ${counts.unchanged} · 其他保留 ${result.retained}`));
    output.append(node('p', 'hint', '确认将覆盖所列节点的名称、层级、状态、终端关联；带 ID 的记录按文件替换。省略整个节点不会删除它。'));
    for (const warning of result.warnings) output.append(node('p', 'form-error', warning));
    const list = node('ul');
    for (const change of result.changes) list.append(node('li', '', `${change.status === 'added' ? '新增' : '更新'}：${change.title}（${change.fields.join('、')}）`));
    output.append(list);
    byId('markdown-apply').disabled = false;
  } catch (error) { byId('markdown-error').textContent = error.message; }
});
byId('markdown-apply').addEventListener('click', async event => {
  const preview = markdownPreview;
  if (!preview || preview.source !== byId('markdown-input').value) return;
  try {
    await run('markdown_import', { markdown: preview.source, revision: preview.revision }, event.currentTarget);
    invalidateMarkdown();
    byId('markdown-dialog').close();
    switchTab('tasks');
  } catch (error) {
    invalidateMarkdown();
    byId('markdown-error').textContent = error.message + ' 请重新预览后再确认。';
  }
});
byId('open-v1').addEventListener('click', event => safely(run('open_v1', {}, event.currentTarget)));

byId('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = Object.fromEntries(new FormData(form));
    await run('task', payload, form.querySelector('[type=submit]'));
    const tree = treeIndex();
    let parent = payload.parent_id;
    while (parent && tree.nodes.has(parent)) { branches.add(parent); parent = tree.nodes.get(parent).parent_id; }
    remember(); render();
    byId('task-dialog').close();
    switchTab('tasks');
  } catch (error) { form.querySelector('.form-error').textContent = error.message; }
});

byId('command-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const editing = Boolean(form.elements.original_id.value);
    const result = await run('command', { ...Object.fromEntries(new FormData(form)), create_on_open: form.elements.create_on_open.checked, command_revision: commandEditRevision }, form.querySelector('[type=submit]'));
    byId('command-dialog').close();
    if (associateCommand) {
      commandOptions(result.created_command);
      byId('association-hint').textContent = editing ? '入口已更新并选中；未影响正在运行的终端。请保存任务以保留关联。' : '新入口已创建并选中。请点击「保存任务」完成关联；尚未启动终端。';
      byId('task-form').elements.command_id.focus();
    } else {
      switchTab('commands');
    }
  } catch (error) { form.querySelector('.form-error').textContent = error.message; }
});

byId('ssh-host-refresh').addEventListener('click', () => safely(loadSshHosts()));
byId('ssh-host-select').addEventListener('change', event => {
  if (!event.currentTarget.value) return;
  byId('command-form').elements.host.value = event.currentTarget.value;
  resetTmux();
});
byId('command-form').elements.host.addEventListener('input', () => {
  const value = byId('command-form').elements.host.value.trim();
  const select = byId('ssh-host-select');
  select.value = [...select.options].some(option => option.value === value) ? value : '';
  resetTmux();
});
byId('list-tmux').addEventListener('click', async event => {
  const form = byId('command-form');
  const host = form.elements.host.value.trim();
  const request = ++tmuxRequest;
  const trigger = event.currentTarget;
  trigger.disabled = true;
  trigger.textContent = '查询中…';
  byId('tmux-status').textContent = `正在查询 ${host || 'SSH 主机'}，通常几秒内返回，最多等待约 18 秒…`;
  byId('tmux-status').className = 'hint';
  byId('sessions').replaceChildren();
  byId('session-list').replaceChildren();
  try {
    const result = await api('tmux_list', { host });
    if (request !== tmuxRequest) return;
    byId('session-list').replaceChildren(...result.sessions.map(session => new Option(session.name, session.name)));
    byId('sessions').replaceChildren(...result.sessions.map(session => button(`${session.name} · ${session.windows}窗 · ${session.attached}连接`, () => {
      form.elements.session.value = session.name;
      if (!form.elements.title.value) form.elements.title.value = session.name;
      byId('tmux-status').textContent = `已选择 ${host} / ${session.name}。继续保存入口即可；尚未连接终端。`;
    })));
    byId('tmux-status').textContent = result.message;
    form.querySelector('.form-error').textContent = '';
  } catch (error) {
    if (request !== tmuxRequest) return;
    byId('tmux-status').textContent = error.message;
    byId('tmux-status').className = 'form-error';
  } finally {
    if (request === tmuxRequest) { trigger.disabled = false; trigger.textContent = '查询远端'; }
  }
});

byId('create-tmux').addEventListener('click', () => {
  const form = byId('command-form');
  pendingCreate = { host: form.elements.host.value, session: form.elements.session.value };
  if (!pendingCreate.host.trim() || !pendingCreate.session.trim()) { form.querySelector('.form-error').textContent = '请先填写 SSH 主机和 tmux session。'; return; }
  byId('confirm-text').textContent = `在 ${pendingCreate.host} 创建 ${pendingCreate.session}？`;
  byId('confirm-dialog').showModal();
});
byId('cancel-create').addEventListener('click', () => { byId('confirm-dialog').close(); pendingCreate = null; });
byId('confirm-create').addEventListener('click', async event => {
  try {
    await run('tmux_create', { ...pendingCreate, confirmed: true }, event.currentTarget);
    byId('confirm-dialog').close();
    byId('command-form').querySelector('.form-error').textContent = '';
  } catch (error) { byId('confirm-text').textContent = error.message; }
});

byId('note-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingNoteEdit) return;
  const form = event.currentTarget;
  try {
    await run('note_edit', { ...pendingNoteEdit, note: form.elements.note.value }, form.querySelector('[type=submit]'));
    byId('note-edit-dialog').close();
    pendingNoteEdit = null;
  } catch (error) {
    form.querySelector('.form-error').textContent = error.message + ' 当前草稿仍保留；请先复制草稿，取消后刷新并重新编辑。';
  }
});

refresh();
