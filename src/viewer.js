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

function render(data) {
  const capsule = validate(data);
  pause();
  current = capsule;
  excluded.clear();
  notice();
  el('workspace').hidden = false;
  el('headline').textContent = 'Captured session';
  el('summary').textContent = capsule.page ? capsule.page + ' · ' +
    new Date(capsule.end).toLocaleString() : new Date(capsule.end).toLocaleString();
  el('count').textContent = capsule.rows.length + ' EVENTS';
  const hasReplay = capsule.replay.length > 1;
  frame.hidden = !hasReplay;
  el('no-replay').hidden = hasReplay;
  el('include-replay').checked = false;
  el('include-replay').disabled = !hasReplay;
  play.disabled = !hasReplay || capsule.start === capsule.end;
  seek.max = capsule.end - capsule.start;
  const firstFailure = capsule.rows.find(row => row.kind === 'network' || row.kind === 'error');
  setTime(firstFailure?.at ?? capsule.start, false);
  send('load', { events: capsule.replay, time });
  const rows = el('rows');
  rows.replaceChildren();
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
  }
  if (!capsule.rows.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No timeline events in this window.';
    rows.append(empty);
  }
}

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
  try {
    if (file.size > maxFileBytes) throw new Error('Capsules must be 8 MB or smaller.');
    render(JSON.parse(await file.text()));
  } catch (error) {
    notice(error instanceof SyntaxError ? 'The file could not be parsed as JSON.' : error.message);
  } finally {
    event.target.value = '';
  }
});

el('sample').addEventListener('click', async () => {
  try {
    const response = await fetch('sample.capsule.json');
    if (!response.ok) throw new Error('The sample capsule could not be loaded.');
    render(await response.json());
  } catch (error) {
    notice(error.message);
  }
});

el('export').addEventListener('click', () => {
  const capsule = {
    ...current,
    page: '',
    rows: current.rows.filter(row => !excluded.has(row.id)),
    replay: el('include-replay').checked ? current.replay : []
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(capsule)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dashcam-' + new Date(capsule.end).toISOString().replaceAll(':', '-') + '.capsule.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notice('Capsule exported.');
});

const captureKey = location.hash.slice(1);
if (/^capture-[0-9a-f-]{36}$/.test(captureKey)) {
  chrome.storage.session.get(captureKey).then(async data => {
    const capsule = data[captureKey];
    if (capsule) {
      render(capsule);
      await chrome.storage.session.remove(captureKey);
    } else {
      notice('This capture is unavailable. Save a new one from the extension.');
    }
  }).catch(error => notice(error.message));
}
