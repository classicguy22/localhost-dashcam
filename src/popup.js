import { channel } from './protocol.js';

const status = document.querySelector('#status');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const save = document.querySelector('#save');
const activeTab = chrome.tabs.query({ active: true, currentWindow: true });

async function send(action) {
  const [tab] = await activeTab;
  const result = await chrome.tabs.sendMessage(tab.id, { channel, action });
  if (result?.error) throw new Error(result.error);
  return result;
}

function render(recording) {
  start.hidden = recording;
  stop.hidden = save.hidden = !recording;
  status.textContent = recording
    ? 'Recording · this page only'
    : 'Ready on this tab. Captures stay in your browser.';
  status.classList.toggle('recording', recording);
}

function bind(button, action) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      status.textContent = error.message || 'The action could not be completed.';
    } finally {
      button.disabled = false;
    }
  });
}

bind(start, async () => render((await send('start')).recording));
bind(stop, async () => render((await send('stop')).recording));
bind(save, async () => {
  const { capsule } = await send('save');
  if (!capsule) {
    render(false);
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
bind(document.querySelector('#open'), () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }));

send('status').then(result => render(result.recording)).catch(() => {
  status.textContent = 'Open or reload a localhost or 127.0.0.1 web page to record.';
});
