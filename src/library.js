import { channel } from './protocol.js';

export function connectLibrary({ capsule, open, notice }) {
  if (location.protocol !== 'chrome-extension:') return;
  const el = id => document.getElementById(id);
  const dialog = el('library');
  const list = el('library-list');
  const search = el('library-search');
  let entries = [];

  async function send(action, fields) {
    const result = await chrome.runtime.sendMessage({ channel, action, ...fields });
    if (result?.error) throw new Error(result.error);
    entries = result.entries;
    draw();
  }

  function bind(target, handler) {
    target.addEventListener('click', async () => {
      target.disabled = true;
      try {
        await handler();
      } catch (error) {
        if (dialog.open) el('library-status').textContent = error.message;
        else notice(error.message);
      } finally {
        target.disabled = false;
      }
    });
  }

  function draw() {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    for (const entry of entries) {
      const failure = entry.capsule.rows.find(row => row.kind === 'error' || row.kind === 'network');
      const summary = [entry.capsule.page, new Date(entry.capsule.end).toLocaleString(), failure?.message]
        .filter(Boolean).join(' · ');
      if (!(entry.name + ' ' + summary).toLowerCase().includes(query)) continue;
      const item = document.createElement('li');
      const name = document.createElement('input');
      name.value = entry.name;
      name.maxLength = 100;
      name.setAttribute('aria-label', 'Capture name');
      const meta = document.createElement('small');
      meta.textContent = summary;
      const actions = document.createElement('div');
      actions.className = 'library-actions';
      for (const [label, handler] of [
        ['Open', () => { open(entry.capsule); dialog.close(); }],
        ['Rename', () => send('library-rename', { id: entry.id, name: name.value.trim() || entry.name })],
        ['Delete', () => {
          if (confirm('Delete this saved capture?')) return send('library-delete', { id: entry.id });
        }]
      ]) {
        const button = document.createElement('button');
        button.textContent = label;
        bind(button, handler);
        actions.append(button);
      }
      item.append(name, meta, actions);
      list.append(item);
    }
    el('library-status').textContent = list.children.length ? '' :
      entries.length ? 'No matching captures.' : 'No saved captures yet.';
  }

  search.addEventListener('input', draw);
  el('library-open').hidden = el('library-save').hidden = false;
  bind(el('library-open'), async () => {
    dialog.showModal();
    await send('library-list');
  });
  bind(el('library-save'), async () => {
    const data = capsule();
    const failure = data.rows.find(row => row.kind === 'error' || row.kind === 'network');
    await send('library-save', { name: failure?.message || 'Saved capture', capsule: data });
    notice('Saved to your capture library.');
  });
}
