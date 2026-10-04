(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  let state = { profiles: [] };
  let editing;
  let lastSelection;
  let lastRoot;
  let currentProvider = 'postgres';
  let activeTab = 'builder';
  let draftChanged = false;
  let settingsDirty = false;
  const settingKeys = ['schemaDir', 'typescriptDir', 'typescriptMetadata', 'pythonMetadata', 'dotnetDir', 'golangDir', 'rustDir'];

  const send = (type, data = {}) => vscode.postMessage({ type, root: state.root, ...data });

  const defaultPorts = {
    postgres: '5432',
    mysql: '3306',
    mssql: '1433',
    nbase: '1307'
  };

  const providerNames = {
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    mssql: 'SQL Server',
    sqlite: 'SQLite',
    googlesheets: 'Google Sheets',
    nbase: 'NBase'
  };

  function updateFormAvailability() {
    const sections = { sqlFields: ['postgres', 'mysql', 'mssql', 'nbase'].includes(currentProvider), sqliteFields: currentProvider === 'sqlite', sheetsFields: currentProvider === 'googlesheets' };
    Object.entries(sections).forEach(([id, visible]) => $(id).querySelectorAll('input,select').forEach(input => { input.disabled = !!state.busy || activeTab !== 'builder' || !visible; }));
    $('connectionString').disabled = !!state.busy || activeTab !== 'raw';
  }

  function setProvider(provider, skipUriUpdate = false) {
    currentProvider = provider;
    $('name').placeholder = `Development · ${providerNames[provider]}`;
    $('presetToolbar').classList.toggle('hidden', provider === 'googlesheets');
    document.querySelectorAll('.chip').forEach(el => {
      el.classList.toggle('active', el.dataset.provider === provider);
    });

    // Toggle field visibility
    const isSql = ['postgres', 'mysql', 'mssql', 'nbase'].includes(provider);
    $('sqlFields').classList.toggle('hidden', !isSql);
    $('sqliteFields').classList.toggle('hidden', provider !== 'sqlite');
    $('sheetsFields').classList.toggle('hidden', provider !== 'googlesheets');

    // Toggle provider specific options
    $('postgresOptions').classList.toggle('hidden', provider !== 'postgres');
    $('mssqlOptions').classList.toggle('hidden', provider !== 'mssql');

    // Update port placeholder and value if default
    if (isSql && defaultPorts[provider]) {
      const portInput = $('fPort');
      portInput.placeholder = defaultPorts[provider];
      if (!portInput.value || Object.values(defaultPorts).includes(portInput.value)) {
        portInput.value = defaultPorts[provider];
      }
    }

    updateFormAvailability();
    if (!skipUriUpdate) {
      updateUriFromBuilder();
    }
  }

  function setTab(tab) {
    if (tab === 'builder' && activeTab === 'raw' && $('connectionString').value && !parseUriToBuilder($('connectionString').value)) {
      showError('This connection uses advanced options. Keep it in connection string mode to preserve them.'); return;
    }
    activeTab = tab;
    $('connectionString').required = tab === 'raw' && !editing;
    $('tabBuilder').setAttribute('aria-pressed', String(tab === 'builder'));
    $('tabRaw').setAttribute('aria-pressed', String(tab === 'raw'));
    $('tabBuilder').classList.toggle('active', tab === 'builder');
    $('tabRaw').classList.toggle('active', tab === 'raw');
    $('builderSection').classList.toggle('hidden', tab !== 'builder');
    $('rawSection').classList.toggle('hidden', tab !== 'raw');
    updateFormAvailability();
  }

  function getRawPassword() {
    return $('fPassword').value;
  }

  function buildUri(mask = false) {
    const host = ($('fHost').value || 'localhost').trim();
    const port = ($('fPort').value || defaultPorts[currentProvider] || '').trim();
    const db = ($('fDatabase').value || '').trim();
    const user = ($('fUser').value || '').trim();
    const rawPass = getRawPassword();
    const pass = mask ? (rawPass ? '••••••••' : '') : encodeURIComponent(rawPass);
    const auth = user ? (pass ? `${encodeURIComponent(user)}:${pass}@` : `${encodeURIComponent(user)}@`) : '';
    const hostPort = port ? `${host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host}:${port}` : host;

    switch (currentProvider) {
      case 'postgres': {
        const ssl = $('fSsl').value;
        const sslQuery = ssl && ssl !== 'disable' ? `?sslmode=${ssl}` : '';
        return `postgresql://${auth}${hostPort}/${encodeURIComponent(db || 'postgres')}${sslQuery}`;
      }
      case 'mysql': {
        return `mysql://${auth}${hostPort}/${encodeURIComponent(db || 'mysql')}`;
      }
      case 'mssql': {
        const tsc = $('fTrustServerCertificate').checked;
        const enc = $('fEncrypt').checked;
        const params = [];
        params.push(`trustServerCertificate=${tsc}`);
        params.push(`encrypt=${enc}`);
        const q = params.length ? `?${params.join('&')}` : '';
        return `sqlserver://${auth}${hostPort}/${encodeURIComponent(db || 'master')}${q}`;
      }
      case 'sqlite': {
        const p = ($('fSqlitePath').value || './dev.sqlite').trim();
        return `sqlite:${p}`;
      }
      case 'googlesheets': {
        const sid = ($('fSpreadsheetId').value || '').trim();
        const email = ($('fClientEmail').value || '').trim();
        const key = mask ? '••••••••' : ($('fPrivateKey').value || '').trim();
        const apiKey = mask && $('fApiKey').value ? '••••••••' : ($('fApiKey').value || '').trim();
        let uri = `googlesheets://${sid}`;
        const parts = [];
        if (email) parts.push(`clientEmail=${encodeURIComponent(email)}`);
        if (key) parts.push(`privateKey=${encodeURIComponent(key)}`);
        if (apiKey) parts.push(`apiKey=${encodeURIComponent(apiKey)}`);
        return parts.length ? `${uri};${parts.join(';')}` : uri;
      }
      case 'nbase': {
        return `nbase://${auth}${hostPort}/${encodeURIComponent(db || 'default')}`;
      }
      default:
        return $('connectionString').value;
    }
  }

  function updateUriFromBuilder() {
    if (editing && !draftChanged) {
      // Editing existing profile, keep blank placeholder
      $('previewUri').textContent = 'Saved credentials preserved';
      return;
    }
    const uri = buildUri(false);
    $('connectionString').value = uri;
    $('previewUri').textContent = buildUri(true);
  }

  function showError(text) {
    $('notice').textContent = text; $('notice').classList.remove('hidden'); $('notice').classList.add('error');
  }
  function maskUri(value) {
    return value.replace(/(:\/\/[^@/]*:)[^@]*@/g, '$1••••••••@').replace(/((?:password|pwd|privateKey|apiKey|accessToken|refreshToken|oauthClientSecret)=)[^;&]*/gi, '$1••••••••');
  }
  function parseUriToBuilder(uri) {
    const cs = uri.trim(); if (!cs) return true;
    try {
      if (/^(sqlite:|:memory:$)/i.test(cs)) { setProvider('sqlite', true); $('fSqlitePath').value = cs.replace(/^sqlite:/i, ''); return true; }
      const url = new URL(cs);
      const provider = { 'postgres:':'postgres', 'postgresql:':'postgres', 'mysql:':'mysql', 'mariadb:':'mysql', 'sqlserver:':'mssql', 'mssql:':'mssql', 'nbase:':'nbase' }[url.protocol];
      if (!provider || url.hash) return false;
      const allowed = provider === 'postgres' ? ['sslmode'] : provider === 'mssql' ? ['trustServerCertificate', 'encrypt'] : [];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key))) return false;
      setProvider(provider, true);
      $('fHost').value = url.hostname; $('fPort').value = url.port || defaultPorts[provider];
      $('fDatabase').value = decodeURIComponent(url.pathname.slice(1));
      $('fUser').value = decodeURIComponent(url.username); $('fPassword').value = decodeURIComponent(url.password);
      $('fSsl').value = url.searchParams.get('sslmode') || 'disable';
      if (provider === 'postgres' && !$('fSsl').value) return false;
      if (provider === 'mssql') {
        $('fTrustServerCertificate').checked = url.searchParams.get('trustServerCertificate') === 'true';
        $('fEncrypt').checked = url.searchParams.get('encrypt') === 'true';
      }
      return true;
    } catch { return false; }
  }

  function edit(profile) {
    if (profile?.project) profile = undefined;
    $('form').reset();
    editing = profile?.id; draftChanged = false;
    $('fPassword').type = 'password'; $('togglePassword').textContent = '👁';
    $('editingHelp').classList.toggle('hidden', !profile);
    document.querySelectorAll('.target-card').forEach(card => card.classList.toggle('active', !!card.querySelector('input:checked')));
    $('testBox').classList.add('hidden');
    $('formTitle').textContent = profile
      ? 'Edit connection'
      : (state.configureMode ? `Configure ${state.workspace} connection` : 'New connection');

    $('name').value = profile?.name || (state.configureMode ? `${state.workspace} · ${providerNames[currentProvider]}` : '');
    $('connectionString').value = '';
    $('connectionString').required = false;
    $('connectionString').placeholder = profile
      ? 'Leave blank to keep saved credentials'
      : 'postgresql://user:password@host:5432/database';
    $('save').textContent = profile ? 'Save changes' : 'Save connection';

    if (profile) {
      const p = profile.provider === 'postgres' ? 'postgres'
        : profile.provider === 'mysql' ? 'mysql'
        : profile.provider === 'mssql' ? 'mssql'
        : profile.provider === 'sqlite' ? 'sqlite'
        : profile.provider === 'googlesheets' ? 'googlesheets'
        : profile.provider === 'nbase' ? 'nbase'
        : 'postgres';
      setProvider(p, true);
      setTab('raw'); $('previewUri').textContent = 'Saved credentials preserved';
    } else {
      setProvider('postgres', true); setTab('builder');
      $('previewUri').textContent = buildUri(true);
    }
  }

  function button(label, callback) {
    const el = document.createElement('button'); el.className = 'link'; el.textContent = label;
    el.addEventListener('click', callback); return el;
  }

  function render(next) {
    state = next;
    if (next.root !== lastRoot) { settingsDirty = false; edit(); lastSelection = undefined; lastRoot = next.root; }
    if (!settingsDirty) settingKeys.forEach(key => { $(key).value = next.settings?.[key] || ''; });
    $('googleStatus').textContent = next.googleLocal === false ? 'Desktop Google sign-in is available in a local VS Code window.' : next.googleConfigured ? 'OAuth application ready. Sign in to select a spreadsheet.' : 'First, import or enter your Google Desktop OAuth application.';
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
    document.querySelectorAll('button,input,select').forEach(el => { el.disabled = next.busy; });
    updateFormAvailability();
    if (!next.trusted) document.querySelectorAll('#saveSettings,#save,#testDraft,#googleSignIn,#googleConfigure,#googleSaveClient,#import,[data-action="generate"],[data-action="push"],[data-action="pull"],[data-action="schema"]').forEach(el => { el.disabled = true; });
  }

  // Event Listeners for form inputs
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    const target = document.querySelector('input[name="target"]:checked')?.value || 'secret';
    let cs = $('connectionString').value.trim();
    if (activeTab === 'builder' && (!editing || draftChanged)) cs = buildUri(false);
    if (!cs && !editing) { showError('Enter database details or a connection string.'); return; }
    if (!state.trusted || state.busy) return;
    send('save', { id: editing, name: $('name').value, connectionString: cs, target });
  });

  // Builder inputs change
  ['fHost', 'fPort', 'fDatabase', 'fUser', 'fPassword', 'fSsl', 'fSqlitePath', 'fSpreadsheetId', 'fClientEmail', 'fApiKey', 'fPrivateKey'].forEach(id => {
    $(id)?.addEventListener('input', () => { draftChanged = true; $('testBox').classList.add('hidden'); updateUriFromBuilder(); });
  });
  ['fTrustServerCertificate', 'fEncrypt'].forEach(id => {
    $(id)?.addEventListener('change', () => { draftChanged = true; $('testBox').classList.add('hidden'); updateUriFromBuilder(); });
  });

  // Raw connection string change
  $('connectionString').addEventListener('input', () => {
    const val = $('connectionString').value;
    draftChanged = true; $('testBox').classList.add('hidden'); $('previewUri').textContent = maskUri(val);
  });

  // Provider chips
  document.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', () => {
      draftChanged = true; setProvider(el.dataset.provider);
      if (!editing && state.configureMode) {
        $('name').value = `${state.workspace} · ${providerNames[currentProvider]}`;
      }
    });
  });

  // Mode Tabs
  $('tabBuilder').addEventListener('click', () => setTab('builder'));
  $('tabRaw').addEventListener('click', () => setTab('raw'));

  // Password toggle
  $('togglePassword').addEventListener('click', () => {
    const input = $('fPassword');
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    $('togglePassword').textContent = isPass ? '🙈' : '👁';
  });

  // Quick SQLite presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('fSqlitePath').value = btn.dataset.sqlite;
      updateUriFromBuilder();
    });
  });

  // Browse SQLite file
  $('browseSqlite').addEventListener('click', () => send('browseSqlite'));

  // Test draft connection
  $('testDraft').addEventListener('click', () => {
    let cs = $('connectionString').value.trim();
    if (activeTab === 'builder' && (!editing || draftChanged)) cs = buildUri(false);
    if (!cs) {
      $('notice').textContent = 'Enter connection details to test.';
      $('notice').classList.remove('hidden');
      $('notice').classList.add('error');
      return;
    }
    const box = $('testBox');
    const status = $('testStatus');
    box.classList.remove('hidden');
    status.className = 'test-status loading';
    status.textContent = '⏳ Testing connection...';
    send('testDraft', { connectionString: cs });
  });

  // Target radio styling
  document.querySelectorAll('.target-card input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.target-card').forEach(c => c.classList.remove('active'));
      radio.closest('.target-card').classList.add('active');
    });
  });

  // Copy URI
  $('copyUri').addEventListener('click', async () => {
    const uri = activeTab === 'raw' ? $('connectionString').value : editing && !draftChanged ? '' : buildUri(false);
    if (!uri) { showError('Saved credentials are private. Enter a new connection to copy it.'); return; }
    try {
      await navigator.clipboard.writeText(uri);
      const prev = $('copyUri').textContent;
      $('copyUri').textContent = 'Copied!';
      setTimeout(() => { $('copyUri').textContent = prev; }, 1500);
    } catch { /* ignore */ }
  });

  for (const id of ['add', 'emptyAdd', 'cancel']) $(id).addEventListener('click', () => { edit(); $('name').focus(); });
  for (const id of ['import', 'default', 'reference', 'workspace']) $(id).addEventListener('click', () => send(id));
  document.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => send('action', { action: el.dataset.action })));

  window.addEventListener('message', event => {
    const m = event.data;
    if (m.type === 'state') render(m);
    if (m.type === 'googleConfigured') { $('googleClientSecret').value = ''; $('googleSetup').open = false; }
    if (m.type === 'settingsSaved') { settingsDirty = false; $('settingsStatus').textContent = 'Project settings saved.'; }
    if (m.type === 'connectionSaved') { edit(); }
    if (m.type === 'notice') {
      $('notice').textContent = m.text;
      $('notice').classList.remove('hidden');
      $('notice').classList.toggle('error', !!m.error);
    }
    if (m.type === 'testDraftResult') {
      const box = $('testBox');
      const status = $('testStatus');
      box.classList.remove('hidden');
      if (m.success) {
        status.className = 'test-status success';
        status.textContent = `🟢 Connected · ${m.latencyMs} ms (${m.provider})`;
      } else {
        status.className = 'test-status error';
        status.textContent = `🔴 Failed: ${m.error || 'Connection failed'}`;
      }
    }
    if (m.type === 'sqliteChosen') {
      $('fSqlitePath').value = m.path;
      updateUriFromBuilder();
    }
  });

  settingKeys.forEach(key => $(key).addEventListener('input', () => { settingsDirty = true; $('settingsStatus').textContent = 'Unsaved changes'; }));
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault(); if (state.busy || !state.trusted) return;
    send('saveSettings', { settings: Object.fromEntries(settingKeys.map(key => [key, $(key).value.trim()])) });
  });
  $('resetSettings').addEventListener('click', () => { settingsDirty = false; render(state); $('settingsStatus').textContent = 'Settings restored.'; });
  $('localPreset').addEventListener('click', () => {
    if (!['postgres', 'mysql', 'mssql', 'nbase'].includes(currentProvider)) setProvider('postgres', true);
    $('fHost').value = 'localhost'; $('fPort').value = defaultPorts[currentProvider];
    $('fDatabase').value = {postgres:'postgres',mysql:'mysql',mssql:'master',nbase:'default'}[currentProvider];
    $('fUser').value = {postgres:'postgres',mysql:'root',mssql:'sa',nbase:'admin'}[currentProvider];
    $('fPassword').value = ''; draftChanged = true; $('testBox').classList.add('hidden'); updateUriFromBuilder();
  });
  $('sqlitePreset').addEventListener('click', () => { draftChanged = true; setProvider('sqlite'); });

  $('googleSignIn').addEventListener('click', () => {
    if (state.googleLocal === false) { showError('Open a local VS Code window to sign in with Google.'); return; }
    if (!state.googleConfigured) { $('googleSetup').open = true; $('googleClientId').focus(); return; }
    send('googleSignIn', { name: $('name').value.trim() });
  });
  $('googleConfigure').addEventListener('click', () => send('googleConfigure'));
  $('googleHelp').addEventListener('click', () => send('googleHelp'));
  $('googleSaveClient').addEventListener('click', () => {
    const clientId = $('googleClientId').value.trim();
    if (!clientId.endsWith('.apps.googleusercontent.com')) { showError('Enter the Client ID for a Google Desktop OAuth application.'); return; }
    send('googleSaveClient', { clientId, clientSecret: $('googleClientSecret').value.trim() });
  });

  edit();
  send('ready');
})();
