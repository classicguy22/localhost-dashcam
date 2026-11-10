import { record, EventType } from 'rrweb';
import { channel, localPath, windowMs, replayBudget } from './protocol.js';

let session;

function addRow(kind, message, detail = '') {
  if (!session) return;
  const at = Date.now();
  session.rows.push({ id: ++session.sequence, at, kind, message: message.slice(0, 300), detail: detail.slice(0, 400) });
  session.rows = session.rows.filter(row => row.at >= at - windowMs).slice(-400);
}

function addReplay(event) {
  const { segments } = session;
  if (event.type === EventType.Meta) {
    session.meta = event;
    return;
  }
  if (event.type === EventType.FullSnapshot) {
    const events = session.meta ? [session.meta, event] : [event];
    const size = JSON.stringify(events).length;
    segments.push({ at: event.timestamp, size, events });
    session.meta = null;
  } else {
    const segment = segments.at(-1);
    if (!segment || segment.size > replayBudget) return;
    segment.size += JSON.stringify(event).length + 1;
    if (segment.size <= replayBudget) segment.events.push(event);
  }
  const cutoff = Date.now() - windowMs;
  while (segments.length > 1 && (segments[1].at <= cutoff ||
      segments.reduce((sum, segment) => sum + segment.size, 0) > replayBudget)) {
    segments.shift();
  }
  if (segments[0]?.size > replayBudget) segments.shift();
}

function onClick(event) {
  const element = event.target;
  if (!event.isTrusted || !(element instanceof Element) || element.closest('[data-dashcam-private]')) return;
  const target = element.closest('button, a, input, select, textarea, [role="button"]') || element;
  const label = target.getAttribute('data-dashcam-label') || target.localName;
  addRow('click', 'Clicked ' + label, localPath(location.href));
}

function onRoute() {
  const url = localPath(location.href);
  if (session.url !== url) {
    addRow('navigation', 'URL changed', url);
    session.url = url;
  }
}

function start() {
  if (session) return;
  session = { started: Date.now(), url: localPath(location.href), rows: [], segments: [], sequence: 0 };
  session.stopReplay = record({
    emit: addReplay,
    maskAllInputs: true,
    blockSelector: '[data-dashcam-private]',
    recordCanvas: false,
    recordCrossOriginIframes: false,
    inlineStylesheet: true,
    inlineImages: false,
    sampling: { mousemove: false }
  });
  session.routeTimer = setInterval(onRoute, 250);
  session.replayTimer = setInterval(() => record.takeFullSnapshot(true), 10_000);
  document.addEventListener('click', onClick, true);
  window.postMessage({ channel, control: 'start' }, location.origin);
  addRow('navigation', 'Recording started', session.url);
}

function stop() {
  if (!session) return;
  session.stopReplay?.();
  clearInterval(session.routeTimer);
  clearInterval(session.replayTimer);
  document.removeEventListener('click', onClick, true);
  window.postMessage({ channel, control: 'stop' }, location.origin);
  session = undefined;
}

function snapshot() {
  onRoute();
  const end = Date.now();
  const start = Math.max(session.started, end - windowMs);
  const segments = session.segments;
  const baseline = segments.findLastIndex(segment => segment.at <= start);
  return {
    format: 'localhost-dashcam',
    version: 1,
    page: session.url,
    start,
    end,
    rows: session.rows.filter(row => row.at >= start),
    replay: segments.slice(Math.max(0, baseline)).flatMap(segment => segment.events)
  };
}

window.addEventListener('message', event => {
  if (!session || event.source !== window || event.origin !== location.origin) return;
  const { channel: source, kind, message, detail } = event.data || {};
  if (source === channel && ['error', 'network'].includes(kind) &&
      typeof message === 'string' && typeof detail === 'string') addRow(kind, message, detail);
});

window.addEventListener('pagehide', stop);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== channel) return;
  try {
    if (message.action === 'start') start();
    if (message.action === 'stop') stop();
    if (message.action === 'save' && session) {
      respond({ recording: true, capsule: snapshot() });
    } else {
      respond({ recording: Boolean(session) });
    }
  } catch {
    stop();
    respond({ error: 'The recorder could not start on this page.' });
  }
});
