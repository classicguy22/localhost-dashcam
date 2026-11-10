import { record, EventType } from 'rrweb';
import { channel, localPath, windowMs, replayBudget } from './protocol.js';

let session;
let stateRevision = 0;

async function updateArm(action, capsule, bodies) {
  const result = await chrome.runtime.sendMessage({ channel, action, capsule, bodies });
  if (result?.error) throw new Error(result.error);
  return result;
}

async function resumeIfArmed() {
  const revision = stateRevision;
  try {
    const { armed, bodies } = await updateArm('armed');
    if (armed && revision === stateRevision) start(true, bodies);
  } catch {
    // A page can outlive the extension that injected its recorder.
    if (revision === stateRevision) stop();
  }
}

function addRow(kind, message, detail = '', network, requestId, selector) {
  if (!session) return;
  const at = Date.now();
  session.rows.push({ id: ++session.sequence, at, kind, message: message.slice(0, 300),
    detail: detail.slice(0, 400), network, requestId, selector });
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
  const testId = target.getAttribute('data-testid');
  const candidate = testId && testId.length <= 80
    ? '[data-testid="' + CSS.escape(testId) + '"]'
    : target.id && target.id.length <= 80 ? '#' + CSS.escape(target.id) : '';
  const selector = candidate && document.querySelectorAll(candidate).length === 1 ? candidate : undefined;
  addRow('click', 'Clicked ' + label, localPath(location.href), undefined, undefined, selector);
}

function onRoute() {
  const url = localPath(location.href);
  if (session.url !== url) {
    addRow('navigation', 'URL changed', url);
    session.url = url;
  }
}

function start(resumed = false, bodies = false) {
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
  session.bodies = bodies;
  window.postMessage({ channel, control: 'start', bodies }, location.origin);
  const reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const label = resumed ? (reloaded ? 'Page reloaded' : 'Page opened') : 'Recording started';
  addRow('navigation', label, session.url);
  updateArm('recording').catch(() => {});
}

function stop() {
  if (!session) return;
  clearTimeout(session.failureTimer);
  session.stopReplay?.();
  clearInterval(session.routeTimer);
  clearInterval(session.replayTimer);
  document.removeEventListener('click', onClick, true);
  window.postMessage({ channel, control: 'stop' }, location.origin);
  session = undefined;
}

function saveFailure(capsule) {
  if (!session?.failureTimer) return;
  clearTimeout(session.failureTimer);
  session.failureTimer = undefined;
  session.lastFailureSave = Date.now();
  updateArm('failure', capsule ?? snapshot()).catch(() => {});
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
  const { channel: source, kind, message, detail, network, requestId, preview } = event.data || {};
  if (source !== channel) return;
  if (kind === 'response') {
    if (!session.bodies || typeof requestId !== 'string' || typeof preview !== 'string') return;
    const row = session.rows.find(row => row.requestId === requestId && row.network);
    if (!row) return;
    row.network.preview = preview.slice(0, 2048);
  } else {
    if (!['error', 'network'].includes(kind) || typeof message !== 'string' || typeof detail !== 'string') return;
    const info = kind === 'network' && Number.isFinite(network?.durationMs) ? {
      durationMs: Math.max(0, Math.min(network.durationMs, 86_400_000)),
      status: Number.isInteger(network.status) ? network.status : 0
    } : undefined;
    addRow(kind, message, detail, info, typeof requestId === 'string' ? requestId.slice(0, 40) : undefined);
  }
  if (!session.failureTimer) {
    const sinceLastSave = Date.now() - (session.lastFailureSave ?? 0);
    session.failureTimer = setTimeout(saveFailure, Math.max(200, 3_000 - sinceLastSave));
  }
});

window.addEventListener('pagehide', () => {
  stateRevision++;
  if (session) {
    const capsule = snapshot();
    saveFailure(capsule);
    updateArm('checkpoint', capsule).catch(() => {});
  }
  stop();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) resumeIfArmed();
});

async function handle({ action, bodies }) {
  if (action === 'start' || action === 'stop') {
    const revision = ++stateRevision;
    if (action === 'start') {
      await updateArm('arm', undefined, bodies === true);
      if (revision !== stateRevision) return { recording: Boolean(session) };
      try {
        start(false, bodies === true);
      } catch (error) {
        stop();
        await updateArm('disarm');
        throw error;
      }
    } else {
      await updateArm('disarm');
      stop();
    }
  }
  if (action === 'save' && session) {
    const { capsule } = await updateArm('capture', snapshot());
    return { recording: Boolean(session), capsule };
  }
  return { recording: Boolean(session) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== channel) return;
  handle(message).then(respond, () => respond({ error: 'Could not update the recorder for this tab.' }));
  return true;
});

resumeIfArmed();
