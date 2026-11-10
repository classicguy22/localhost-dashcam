import { channel } from './protocol.js';

const el = id => document.getElementById(id);
const status = el('status');
const start = el('start');
const stop = el('stop');
const save = el('save');
const activeTab = chrome.tabs.query({ active: true, currentWindow: true });

async function send(action) {
  const [tab] = await activeTab;
  const result = await chrome.tabs.sendMessage(tab.id, { channel, action });
  if (result?.error) throw new Error(result.error);
  return result;
}

function render(state) {
  const recording = state === 'recording';
  const supported = state !== 'unavailable';
  el('popup-card').dataset.state = state;
  el('indicator').textContent = recording ? 'Recording' : supported ? 'Ready to arm' : 'Waiting for localhost';
  el('popup-title').textContent = recording ? 'Rolling capture' : supported ? 'Catch the next bug' : 'Open a local app';
  status.textContent = recording
    ? 'The last minute stays in memory. This tab re-arms when the same app reloads.'
    : supported
      ? 'Arm this tab once to capture clicks, console errors, and failed requests.'
      : 'Open or reload a page on localhost or 127.0.0.1 to start recording.';
  start.hidden = !supported || recording;
  stop.hidden = save.hidden = !recording;
}

let busy = false;
function bind(button, action) {
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      status.textContent = error.message || 'The action could not be completed.';
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
}

bind(start, async () => render((await send('start')).recording ? 'recording' : 'ready'));
bind(stop, async () => {
  await send('stop');
  render('ready');
});
bind(save, async () => {
  const { capsule } = await send('save');
  if (!capsule) {
    render('ready');
    return;
  }
  const key = 'capture-' + crypto.randomUUID();
  await chrome.storage.session.set({ [key]: capsule });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html#' + key) });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
});
bind(el('open'), () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }));

send('status').then(result => render(result.recording ? 'recording' : 'ready')).catch(() => {
  render('unavailable');
});
