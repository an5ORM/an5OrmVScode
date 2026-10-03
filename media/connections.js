(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let state = { profiles: [] };
  let editing;
  let lastSelection;
  let lastRoot;
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  function edit(profile) {
    if (profile?.project) profile = undefined;
    editing = profile?.id;
    $('formTitle').textContent = profile ? 'Edit connection' : 'New connection';
    $('name').value = profile?.name || '';
    $('connectionString').value = '';
    $('connectionString').required = !profile;
    $('connectionString').placeholder = profile ? 'Leave blank to keep saved credentials' : 'postgresql://user:password@host:5432/database';
    $('save').textContent = profile ? 'Save changes' : 'Save connection';
  }
  function button(label, callback) {
    const el = document.createElement('button'); el.className = 'link'; el.textContent = label;
    el.addEventListener('click', callback); return el;
  }
  function render(next) {
    state = next;
    if (next.root !== lastRoot) { edit(); lastSelection = undefined; lastRoot = next.root; }
    $('project').textContent = next.workspace;
    $('root').textContent = next.root;
    $('workspace').textContent = next.workspace + ' ▾';
    $('config').textContent = next.configPath || 'Not created';
    $('active').textContent = next.profiles.find(p => p.id === next.activeId)?.name || 'Project default';
    $('count').textContent = String(next.profiles.length);
    $('empty').classList.toggle('hidden', !!next.profiles.length);
    $('restricted').classList.toggle('hidden', next.trusted);
    $('profiles').replaceChildren();
    for (const profile of next.profiles) {
      const row = document.createElement('div'); row.className = 'profile' + (profile.id === next.activeId ? ' active' : '');
      const head = document.createElement('div'); head.className = 'profile-head';
      const name = document.createElement('span'); name.className = 'profile-name'; name.textContent = profile.name; head.append(name);
      if (profile.id === next.activeId) { const badge = document.createElement('span'); badge.className = 'active-badge'; badge.textContent = '● ACTIVE'; head.append(badge); }
      const meta = document.createElement('div'); meta.className = 'profile-meta'; meta.textContent = profile.provider + ' · ' + (profile.status || 'Not tested');
      const actions = document.createElement('div'); actions.className = 'profile-actions';
      actions.append(button('Test', () => send('test', { id: profile.id })), button('Use connection', () => send('use', { id: profile.id })));
      if (profile.project) actions.append(button('Open source', () => send('projectSource')));
      else actions.append(button('Edit', () => edit(profile)), button('Delete', () => send('remove', { id: profile.id })));
      row.append(head, meta, actions); $('profiles').append(row);
    }
    if (next.selectedId !== lastSelection) { edit(next.profiles.find(p => p.id === next.selectedId)); lastSelection = next.selectedId; }
    if (editing && !next.profiles.some(p => p.id === editing)) edit();
    document.querySelectorAll('button').forEach(el => { el.disabled = next.busy; });
    if (!next.trusted) document.querySelectorAll('#save,#import,[data-action="generate"],[data-action="push"],[data-action="pull"],[data-action="schema"]').forEach(el => { el.disabled = true; });
  }
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    send('save', { id: editing, name: $('name').value, connectionString: $('connectionString').value });
    $('connectionString').value = '';
  });
  for (const id of ['add', 'emptyAdd', 'cancel']) $(id).addEventListener('click', () => { edit(); $('name').focus(); });
  for (const id of ['import', 'default', 'reference', 'workspace']) $(id).addEventListener('click', () => send(id));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => send('action', { action: el.dataset.action })));
  window.addEventListener('message', event => {
    const m = event.data;
    if (m.type === 'state') render(m);
    if (m.type === 'notice') { $('notice').textContent = m.text; $('notice').classList.remove('hidden'); $('notice').classList.toggle('error', m.error); }
  });
  edit(); send('ready');
})();
