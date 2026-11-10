import { latestFailureKey, maxFileBytes } from './protocol.js';
import { connectLibrary } from './library.js';

const el = id => document.getElementById(id);
const frame = el('replay');
const messageOrigin = window.origin;
const seek = el('seek');
const play = el('play');
const excluded = new Set();
const kinds = new Set(['navigation', 'click', 'error', 'network']);
let ready = false;
let current;
let timer;
let time = 0;
let filter = 'all';
let entries = [];
let firstFailure;
let failures = [];
let loadRevision = 0;
const isFailure = row => row.kind === 'network' || row.kind === 'error';

function networkDetails(row, includePreview) {
  if (!Number.isFinite(row.network?.durationMs) || !Number.isInteger(row.network.status)) return undefined;
  const { durationMs, status, preview } = row.network;
  return { durationMs, status, ...(includePreview && typeof preview === 'string' ? { preview } : {}) };
}

function validate(data) {
  if (data?.format !== 'localhost-dashcam' || data.version !== 1 ||
      typeof data.page !== 'string' || !Number.isSafeInteger(data.start) ||
      !Number.isSafeInteger(data.end) || data.end < data.start || data.end - data.start > 60_000 ||
      !Array.isArray(data.rows) || data.rows.length > 400 || !Array.isArray(data.replay) ||
      data.replay.length > 50_000 || data.rows.some(row => !row || !Number.isSafeInteger(row.id) ||
        !Number.isSafeInteger(row.at) || row.at < data.start || row.at > data.end ||
        !kinds.has(row.kind) || typeof row.message !== 'string' || typeof row.detail !== 'string') ||
      data.replay.some(event => !event || !Number.isSafeInteger(event.timestamp) ||
        !Number.isInteger(event.type) || typeof event.data !== 'object' || event.data === null) ||
      new Set(data.rows.map(row => row.id)).size !== data.rows.length) {
    throw new Error('This file is not a supported Dashcam capsule.');
  }
  return data;
}

function readNotes(capsule) {
  if (!Array.isArray(capsule.notes)) return [];
  return capsule.notes.slice(0, 30).filter(note => Number.isSafeInteger(note?.at) &&
    note.at >= capsule.start && note.at <= capsule.end &&
    typeof note.expected === 'string' && typeof note.actual === 'string')
    .map(({ at, expected, actual }) => ({ at, expected: expected.slice(0, 500), actual: actual.slice(0, 500) }));
}

function send(action, values) {
  if (ready) frame.contentWindow.postMessage({ action, ...values }, messageOrigin === 'null' ? '*' : messageOrigin);
}

window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== messageOrigin || event.data?.action !== 'ready') return;
  ready = true;
  if (current) send('load', { events: current.replay, time });
});

function notice(message = '') {
  el('notice').textContent = message;
  el('notice').hidden = !message;
}

const offset = ms => '+' + (ms / 1000).toFixed(1) + 's';
const selectedRows = () => current.rows.filter(row => !excluded.has(row.id));

function updateExportSummary() {
  const count = current.rows.length - excluded.size;
  el('export-summary').textContent = count + ' of ' + current.rows.length +
    ' events selected. Review URLs and error messages before sharing.';
  el('copy').disabled = count === 0 && !current.notes.length;
}

function applyFilter() {
  const query = el('search').value.trim().toLowerCase();
  let visible = 0;
  for (const { item, row, searchText } of entries) {
    item.hidden = (filter === 'failure' && !isFailure(row)) ||
      (filter === 'activity' && isFailure(row)) || !searchText.includes(query);
    if (!item.hidden) visible++;
  }
  el('count').textContent = visible + ' / ' + current.rows.length + ' EVENTS';
  el('empty-rows').textContent = current.rows.length ? 'No matching events.' : 'No events in this window.';
  el('empty-rows').hidden = visible > 0;
}

function selectFilter(value) {
  filter = value;
  for (const button of el('filters').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  applyFilter();
}

function setTime(value, notifyPlayer = true) {
  time = value;
  seek.value = time - current.start;
  el('time').textContent = offset(time - current.start) + ' / ' + offset(current.end - current.start);
  el('previous-error').disabled = !failures.some(row => row.at < time);
  el('next-error').disabled = !failures.some(row => row.at > time);
  if (notifyPlayer) send('seek', { time });
}

function pause() {
  clearInterval(timer);
  timer = undefined;
  play.textContent = 'Play';
  play.setAttribute('aria-label', 'Play replay');
  if (current) send('seek', { time });
}

function render(data, source) {
  const capsule = validate(data);
  pause();
  current = capsule;
  current.notes = readNotes(capsule);
  el('note-form').reset();
  el('note-status').textContent = '';
  excluded.clear();
  notice();
  el('share-notice').textContent = '';
  el('welcome').hidden = true;
  el('workspace').hidden = false;
  failures = capsule.rows.filter(isFailure).sort((left, right) => left.at - right.at);
  firstFailure = failures[0];
  el('source').textContent = source + ' / ' + ((capsule.end - capsule.start) / 1000).toFixed(1) + ' SEC';
  el('headline').textContent = failures.length === 1 ? '1 failure captured' :
    failures.length ? failures.length + ' failures captured' : 'Session captured';
  el('jump').hidden = !firstFailure;
  el('summary').textContent = capsule.page ? capsule.page + ' · ' +
    new Date(capsule.end).toLocaleString() : new Date(capsule.end).toLocaleString();
  const hasReplay = capsule.replay.length > 1;
  frame.hidden = !hasReplay;
  el('no-replay').hidden = hasReplay;
  el('include-replay').checked = false;
  el('include-replay').disabled = !hasReplay;
  el('include-previews').checked = false;
  el('preview-option').hidden = !capsule.rows.some(row => typeof row.network?.preview === 'string');
  play.disabled = !hasReplay || capsule.start === capsule.end;
  seek.disabled = !hasReplay || capsule.start === capsule.end;
  seek.max = capsule.end - capsule.start;
  setTime(firstFailure?.at ?? capsule.start, false);
  send('load', { events: capsule.replay, time });
  const rows = el('rows');
  rows.replaceChildren();
  entries = [];
  for (const row of capsule.rows) {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.setAttribute('aria-label', 'Include ' + row.message + ' in export');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) excluded.delete(row.id);
      else excluded.add(row.id);
      item.classList.toggle('excluded', !checkbox.checked);
      updateExportSummary();
    });
    const button = document.createElement('button');
    button.className = 'event';
    const badge = document.createElement('span');
    badge.className = 'badge ' + row.kind;
    badge.textContent = row.kind;
    const label = document.createElement('strong');
    label.textContent = row.message;
    const stamp = document.createElement('time');
    stamp.textContent = offset(row.at - capsule.start);
    button.append(badge, label, stamp);
    if (row.detail) {
      const detail = document.createElement('small');
      detail.textContent = row.detail;
      button.append(detail);
    }
    button.addEventListener('click', () => {
      pause();
      setTime(row.at);
      rows.querySelector('[aria-current]')?.removeAttribute('aria-current');
      button.setAttribute('aria-current', 'true');
    });
    const content = document.createElement('div');
    content.className = 'event-content';
    content.append(button);
    const network = networkDetails(row, true);
    if (network) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Request details · ' + network.durationMs + ' ms';
      const status = document.createElement('p');
      status.textContent = network.status ? 'HTTP status ' + network.status : 'No HTTP response';
      details.append(summary, status);
      if (network.preview) {
        const preview = document.createElement('pre');
        preview.textContent = network.preview;
        details.append(preview);
      }
      content.append(details);
    }
    item.append(checkbox, content);
    rows.append(item);
    entries.push({ item, row, button, searchText: [row.kind, row.message, row.detail].join(' ').toLowerCase() });
  }
  el('search').value = '';
  selectFilter('all');
  entries.find(entry => entry.row === firstFailure)?.button.setAttribute('aria-current', 'true');
  updateExportSummary();
  renderMarkers();
  renderNotes();
}

function renderNotes() {
  const list = el('note-list');
  list.replaceChildren();
  for (const note of current.notes) {
    const item = document.createElement('li');
    const actions = document.createElement('div');
    actions.className = 'library-actions';
    const jump = document.createElement('button');
    jump.textContent = 'Jump to ' + offset(note.at - current.start);
    jump.addEventListener('click', () => { pause(); setTime(note.at); });
    const remove = document.createElement('button');
    remove.textContent = 'Remove note';
    remove.addEventListener('click', () => {
      current.notes = current.notes.filter(entry => entry !== note);
      el('note-status').textContent = 'Note removed.';
      renderNotes();
    });
    actions.append(jump, remove);
    item.append(actions);
    for (const [label, text] of [['Expected', note.expected], ['Actual', note.actual]]) {
      if (!text) continue;
      const paragraph = document.createElement('p');
      paragraph.textContent = label + ': ' + text;
      item.append(paragraph);
    }
    list.append(item);
  }
  el('add-note').disabled = current.notes.length >= 30;
  el('copy').disabled = !current.notes.length && !selectedRows().length;
}

el('note-form').addEventListener('submit', event => {
  event.preventDefault();
  const expected = el('note-expected').value.trim();
  const actual = el('note-actual').value.trim();
  if ((!expected && !actual) || current.notes.length >= 30) return;
  pause();
  current.notes.push({ at: Math.round(time), expected, actual });
  current.notes.sort((left, right) => left.at - right.at);
  event.target.reset();
  el('note-status').textContent = 'Replay note added.';
  renderNotes();
});

function jumpTo(row) {
  const entry = entries.find(entry => entry.row === row);
  if (!entry) return;
  el('search').value = '';
  selectFilter('failure');
  entry.button.click();
  entry.button.focus({ preventScroll: true });
  entry.item.scrollIntoView({ block: 'nearest' });
}

function renderMarkers() {
  const rail = el('failure-markers');
  rail.replaceChildren();
  el('failure-nav').hidden = !failures.length;
  const duration = current.end - current.start;
  // Nearby failures share a marker. The previous and next buttons visit every timestamp.
  const shown = new Set();
  for (const row of failures) {
    const position = duration ? (row.at - current.start) / duration * 100 : 0;
    const bucket = Math.floor(position / 3);
    if (shown.has(bucket)) continue;
    shown.add(bucket);
    const button = document.createElement('button');
    button.style.left = position + '%';
    button.title = row.message + ' at ' + offset(row.at - current.start);
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => jumpTo(row));
    rail.append(button);
  }
  rail.hidden = shown.size === 0;
}

el('filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-filter]');
  if (button) selectFilter(button.dataset.filter);
});
el('search').addEventListener('input', applyFilter);
el('jump').addEventListener('click', () => jumpTo(firstFailure));
el('previous-error').addEventListener('click', () => jumpTo(failures.findLast(row => row.at < time)));
el('next-error').addEventListener('click', () => jumpTo(failures.find(row => row.at > time)));

seek.addEventListener('input', () => {
  pause();
  setTime(current.start + Number(seek.value));
});

play.addEventListener('click', () => {
  if (timer) {
    pause();
    return;
  }
  if (time >= current.end) setTime(current.start);
  const base = time;
  const started = performance.now();
  send('play', { time });
  play.textContent = 'Pause';
  play.setAttribute('aria-label', 'Pause replay');
  timer = setInterval(() => {
    setTime(Math.min(current.end, base + performance.now() - started), false);
    if (time >= current.end) pause();
  }, 50);
});

async function openFile(file) {
  if (!file) return;
  const revision = ++loadRevision;
  try {
    if (file.size > maxFileBytes) throw new Error('Capsules must be 8 MB or smaller.');
    const data = JSON.parse(await file.text());
    if (revision === loadRevision) render(data, 'IMPORTED CAPSULE');
  } catch (error) {
    if (revision === loadRevision) notice(error instanceof SyntaxError ? 'The file could not be parsed as JSON.' : error.message);
  }
}

el('file').addEventListener('change', async event => {
  await openFile(event.target.files[0]);
  event.target.value = '';
});
window.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  openFile(event.dataTransfer.files[0]);
});

async function readSample() {
  const embedded = el('embedded-sample');
  if (embedded) return JSON.parse(embedded.textContent);
  const response = await fetch('sample.capsule.json');
  if (!response.ok) throw new Error('The sample capsule could not be loaded.');
  return response.json();
}

async function loadSample() {
  const revision = ++loadRevision;
  try {
    const data = await readSample();
    if (revision === loadRevision) render(data, 'SAMPLE CAPSULE');
  } catch (error) {
    if (revision === loadRevision) notice(error.message);
  }
}
el('sample').addEventListener('click', loadSample);
el('welcome-sample').addEventListener('click', loadSample);

function inlineMarkdown(text) {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_{}\[\]<>|#&]/g, '\\$&');
}

el('copy').addEventListener('click', async () => {
  const lines = selectedRows().map(row => {
    const detail = row.detail ? ' — ' + inlineMarkdown(row.detail) : '';
    return '- ' + offset(row.at - current.start) + ' · ' + row.kind +
      ' · ' + inlineMarkdown(row.message) + detail;
  });
  try {
    const notes = current.notes.map(note =>
      '- ' + offset(note.at - current.start) + ' · Expected: ' + inlineMarkdown(note.expected) +
      ' · Actual: ' + inlineMarkdown(note.actual));
    if (notes.length) lines.push('', '## Replay notes', '', ...notes);
    await navigator.clipboard.writeText(['# Dashcam bug report', '', ...lines].join('\n'));
    el('share-notice').textContent = 'Bug report copied.';
  } catch {
    el('share-notice').textContent = 'Clipboard unavailable. Download the capsule instead.';
  }
});

el('export').addEventListener('click', () => {
  const capsule = {
    format: current.format,
    version: current.version,
    page: '',
    start: current.start,
    end: current.end,
    notes: current.notes,
    rows: selectedRows().map(row => {
      const { id, at, kind, message, detail } = row;
      return { id, at, kind, message, detail, network: networkDetails(row, el('include-previews').checked) };
    }),
    replay: el('include-replay').checked ? current.replay : []
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(capsule)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dashcam-' + new Date(capsule.end).toISOString().replaceAll(':', '-') + '.capsule.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  el('share-notice').textContent = 'Capsule downloaded.';
});

const captureKey = location.hash.slice(1);
connectLibrary({ capsule: () => current, open: data => render(data, 'SAVED CAPTURE'), notice });
if (location.protocol === 'chrome-extension:' &&
    (captureKey === latestFailureKey || /^capture-[0-9a-f-]{36}$/.test(captureKey))) {
  const revision = ++loadRevision;
  chrome.storage.session.get(captureKey).then(async data => {
    const capsule = data[captureKey];
    if (capsule) {
      const automatic = captureKey === latestFailureKey;
      if (revision === loadRevision) render(capsule, automatic ? 'AUTO-SAVED FAILURE' : 'LIVE CAPTURE');
      if (!automatic) await chrome.storage.session.remove(captureKey);
    } else {
      if (revision === loadRevision) notice('This capture is unavailable. Save a new one from the extension.');
    }
  }).catch(error => notice(error.message));
}
