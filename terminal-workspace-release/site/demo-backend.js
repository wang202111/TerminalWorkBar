(() => {
  const emit = (type, data = {}) => parent.postMessage({ channel: 'terminal-demo-event', type, ...data }, '*');
  let snapshot;
  let nextId = 1;
  const running = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1, 9, 41) + clock++ * 1000).toISOString();
  function reset() {
    running.clear();
    nextId = 1;
    clock = 0;
    snapshot = { version: 2, revision: 0, command_revision: 'demo-0', imports: [], tasks: [
      { id: 'demo-project', parent_id: '', kind: 'group', title: 'Atlas · 演示项目', command_id: '', done: false, notes: [] },
      { id: 'demo-environment', parent_id: 'demo-project', kind: 'task', title: '检查本地环境', command_id: 'demo-shell', done: false, notes: [{ id: 'note-1', text: '这是演示记录，不是真实任务。', created: now() }] },
      { id: 'demo-review', parent_id: 'demo-project', kind: 'task', title: '验证中文输出', command_id: 'demo-ssh', done: false, notes: [] },
    ], commands: [
      { id: 'demo-ssh', title: '远端工作区', mode: 'ssh', host: 'demo-dev', command: 'tmux -u a -t workspace', cwd: '', tmux: { host: 'demo-dev', session: 'workspace', window: '', create_on_open: false } },
      { id: 'demo-shell', title: '本地检查', mode: 'shell', host: '', command: "printf 'Demo terminal\\n'", cwd: '~', tmux: null },
    ] };
    emit('reset');
  }
  function outline() {
    const output = [];
    function visit(parentId, depth) {
      for (const task of snapshot.tasks.filter(entry => entry.parent_id === parentId)) {
        const entry = { ...copy(task), depth };
        entry.notes.sort((left, right) => Date.parse(right.updated || right.created) - Date.parse(left.updated || left.created));
        output.push(entry);
        visit(task.id, depth + 1);
      }
    }
    visit('', 0);
    return output;
  }
  function exportPreview(format) {
    const output = outline();
    const lines = ['# Atlas 工作清单', ''];
    if (format === 'roundtrip') lines.unshift('<!-- terminal-sidebar: {"format":1} -->');
    for (const entry of output) {
      const indent = '  '.repeat(entry.depth);
      let line = `${indent}- [${entry.done ? 'x' : ' '}] ${entry.title}`;
      if (entry.command_id) line += ` [终端](terminal-jump://open/${entry.command_id})`;
      if (format === 'roundtrip') line += ' <!-- ts-node: ' + JSON.stringify({ id: entry.id, kind: entry.kind }) + ' -->';
      lines.push(line);
      for (const note of entry.notes) lines.push(...note.text.split('\n').map(text => indent + '  > ' + text));
    }
    return { outline: output, markdown: lines.join('\n'), revision: snapshot.revision };
  }
  function mutate(message, extra = {}) { snapshot.revision += 1; return { ...copy(snapshot), message, ...extra }; }
  function requireTask(id) {
    const task = snapshot.tasks.find(entry => entry.id === id);
    if (!task) throw new Error('演示节点不存在，请重置。');
    return task;
  }
  function dispatch(action, payload) {
    if (action === 'state') return copy(snapshot);
    if (action === 'ssh_hosts') return { hosts: ['demo-dev', 'demo-staging'], warnings: [], message: '虚构 SSH 别名；没有读取本机 config。' };
    if (action === 'tmux_list') return { sessions: [{ name: 'workspace', windows: 2, attached: 1 }, { name: 'demo-review', windows: 1, attached: 0 }], message: '模拟查询结果；未发起 SSH。' };
    if (action === 'tmux_create') { if (!payload.confirmed) throw new Error('请先确认。'); return { message: '仅模拟创建；没有连接远端服务器。' }; }
    if (action === 'export_preview') return exportPreview(payload.format);
    if (action === 'open') {
      const command = snapshot.commands.find(entry => entry.id === payload.command_id);
      if (!command) throw new Error('演示入口不存在。');
      const reused = running.has(command.id);
      running.add(command.id);
      emit('terminal', { id: command.id, count: running.size, output: reused ? `[模拟] 已定位 ${command.id}\n\n没有发送新指令。\n没有重新连接 SSH / tmux。\n原来的工作继续运行。\n▍` : `[模拟] 创建入口 ${command.id}\n\n$ ${command.mode === 'ssh' ? 'ssh -t ' + command.host + ' ' : ''}${command.command}\n\n以上仅是文字输出，没有执行命令。\n✓ 工作区已就绪\n▍` });
      return { message: reused ? '模拟定位现有终端，没有重复执行。' : '模拟首次打开；真实终端未启动。' };
    }
    if (['export', 'open_v1', 'markdown_source', 'markdown_preview', 'markdown_import', 'import'].includes(action)) throw new Error('此 demo 不提供文件写入、Markdown 导入或原生 App 调用；请在真实应用使用。');
    if (payload.revision !== undefined && payload.revision !== snapshot.revision) throw new Error('演示数据已变化，请刷新。');
    if (action === 'task') {
      if (!payload.title?.trim()) throw new Error('请填写标题。');
      const existing = payload.id ? requireTask(payload.id) : null;
      let ancestor = payload.parent_id || '';
      const visited = new Set(existing ? [existing.id] : []);
      while (ancestor) { if (visited.has(ancestor)) throw new Error('不能形成循环层级。'); visited.add(ancestor); ancestor = requireTask(ancestor).parent_id; }
      const task = existing || { id: 'demo-added-' + nextId++, notes: [], done: false, created: now() };
      Object.assign(task, { title: payload.title.trim(), parent_id: payload.parent_id || '', kind: payload.kind === 'group' ? 'group' : 'task', command_id: payload.command_id || '', updated: now() });
      if (!existing) snapshot.tasks.push(task);
      return mutate('演示任务已保存，只存在本页内存中。');
    }
    if (action === 'complete') { requireTask(payload.id).done = Boolean(payload.done); return mutate('演示状态已更新。'); }
    if (action === 'note') { if (!payload.note?.trim()) throw new Error('请输入记录。'); requireTask(payload.id).notes.push({ id: 'demo-note-' + nextId++, text: payload.note, created: now() }); return mutate('演示记录已追加。'); }
    if (action === 'note_edit') {
      if (!payload.note?.trim()) throw new Error('请输入记录。');
      const note = requireTask(payload.id).notes.find(entry => entry.id === payload.note_id);
      if (!note) throw new Error('演示记录不存在，请重置。');
      note.text = payload.note.trim();
      note.updated = now();
      return mutate('演示记录已修改，只存在本页内存中。');
    }
    if (action === 'command') {
      if (!payload.title?.trim()) throw new Error('请填写入口名称。');
      if (payload.command_revision !== snapshot.command_revision) throw new Error('入口已变化，请重开编辑器。');
      const id = payload.original_id || payload.id || 'demo-command-' + nextId++;
      if (!payload.original_id && snapshot.commands.some(entry => entry.id === id)) throw new Error('演示 ID 已存在。');
      const entry = { id, title: payload.title, mode: payload.mode === 'tmux' ? 'ssh' : payload.mode, host: payload.host || '', command: payload.mode === 'tmux' ? 'tmux -u a -t ' + (payload.session || 'workspace') : payload.command || '', cwd: payload.cwd || '', tmux: payload.mode === 'tmux' ? { host: payload.host, session: payload.session, window: payload.window || '', create_on_open: Boolean(payload.create_on_open) } : null };
      if (!entry.command) throw new Error('请填写指令。');
      snapshot.commands = snapshot.commands.filter(command => command.id !== id).concat(entry);
      snapshot.command_revision = 'demo-' + nextId++;
      return mutate('演示入口已保存，不执行。', { created_command: id });
    }
    if (action === 'command_delete') {
      if (!payload.confirmed || payload.command_revision !== snapshot.command_revision) throw new Error('删除确认失效。');
      snapshot.commands = snapshot.commands.filter(command => command.id !== payload.id);
      snapshot.command_revision = 'demo-' + nextId++;
      return mutate('只移除演示入口，模拟终端仍在运行。');
    }
    if (action === 'task_delete') {
      if (!payload.confirmed || !['node', 'subtree'].includes(payload.scope)) throw new Error('请选择并确认删除范围。');
      const task = requireTask(payload.id);
      const removed = new Set([task.id]);
      if (payload.scope === 'subtree') {
        let changed = true;
        while (changed) { changed = false; for (const child of snapshot.tasks) if (removed.has(child.parent_id) && !removed.has(child.id)) { removed.add(child.id); changed = true; } }
      } else for (const child of snapshot.tasks) if (child.parent_id === task.id) child.parent_id = task.parent_id;
      snapshot.tasks = snapshot.tasks.filter(entry => !removed.has(entry.id));
      return mutate('演示节点已移除。未写入真实备份；重置可恢复全部示例。');
    }
    throw new Error('此演示不支持该操作。');
  }
  window.fetch = async (url, options = {}) => {
    const match = typeof url === 'string' && /^\/api\/([a-z_]+)$/.exec(url);
    if (!match) return { ok: false, json: async () => ({ error: 'Demo 禁止网络请求。' }) };
    try { const result = dispatch(match[1], options.body ? JSON.parse(options.body) : {}); return { ok: true, json: async () => result }; }
    catch (error) { return { ok: false, json: async () => ({ error: error.message }) }; }
  };
  document.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); }, true);
  window.DEMO_BACKEND = { reset, emit };
  reset();
})();
