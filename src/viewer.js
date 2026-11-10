import { maxFileBytes } from './protocol.js';

const el = id => document.getElementById(id);
const frame = el('replay');
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
let loadRevision = 0;
const isFailure = row => row.kind === 'network' || row.kind === 'error';

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

function send(action, values) {
  if (ready) frame.contentWindow.postMessage({ action, ...values }, location.origin);
}

window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.action !== 'ready') return;
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
  el('copy').disabled = count === 0;
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
  excluded.clear();
  notice();
  el('share-notice').textContent = '';
  el('welcome').hidden = true;
  el('workspace').hidden = false;
  const failures = capsule.rows.filter(isFailure);
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
    item.append(checkbox, button);
    rows.append(item);
    entries.push({ item, row, button, searchText: [row.kind, row.message, row.detail].join(' ').toLowerCase() });
  }
  el('search').value = '';
  selectFilter('all');
  entries.find(entry => entry.row === firstFailure)?.button.setAttribute('aria-current', 'true');
  updateExportSummary();
}

el('filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-filter]');
  if (button) selectFilter(button.dataset.filter);
});
el('search').addEventListener('input', applyFilter);
el('jump').addEventListener('click', () => {
  el('search').value = '';
  selectFilter('failure');
  const entry = entries.find(entry => entry.row === firstFailure);
  entry?.button.click();
  entry?.button.focus();
});

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

el('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const revision = ++loadRevision;
  try {
    if (file.size > maxFileBytes) throw new Error('Capsules must be 8 MB or smaller.');
    const data = JSON.parse(await file.text());
    if (revision === loadRevision) render(data, 'IMPORTED CAPSULE');
  } catch (error) {
    if (revision === loadRevision) notice(error instanceof SyntaxError ? 'The file could not be parsed as JSON.' : error.message);
  } finally {
    event.target.value = '';
  }
});

async function loadSample() {
  const revision = ++loadRevision;
  try {
    const response = await fetch('sample.capsule.json');
    if (!response.ok) throw new Error('The sample capsule could not be loaded.');
    const data = await response.json();
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
    rows: selectedRows().map(({ id, at, kind, message, detail }) => ({ id, at, kind, message, detail })),
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
if (/^capture-[0-9a-f-]{36}$/.test(captureKey)) {
  const revision = ++loadRevision;
  chrome.storage.session.get(captureKey).then(async data => {
    const capsule = data[captureKey];
    if (capsule) {
      if (revision === loadRevision) render(capsule, 'LIVE CAPTURE');
      await chrome.storage.session.remove(captureKey);
    } else {
      if (revision === loadRevision) notice('This capture is unavailable. Save a new one from the extension.');
    }
  }).catch(error => notice(error.message));
}
