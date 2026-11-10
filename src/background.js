import { channel, latestFailureKey, supportedOrigin, windowMs } from './protocol.js';
import { stitch } from './stitch.js';

const armKey = tabId => 'armed-' + tabId;
const checkpointKey = 'recent-pages';
const maxCheckpointBytes = 1_800_000;
const maxCheckpoints = 3;

let pending = Promise.resolve();

function enqueue(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function bounded(capsule) {
  const bytes = new TextEncoder().encode(JSON.stringify(capsule)).length;
  return bytes <= maxCheckpointBytes ? capsule : { ...capsule, replay: [] };
}

async function getCheckpoints() {
  const stored = await chrome.storage.session.get(checkpointKey);
  return stored[checkpointKey] ?? [];
}

async function clearTab(tabId) {
  await chrome.storage.session.remove(armKey(tabId));
  const checkpoints = await getCheckpoints();
  const remaining = checkpoints.filter(entry => entry.tabId !== tabId);
  if (remaining.length !== checkpoints.length) {
    await chrome.storage.session.set({ [checkpointKey]: remaining });
  }
}

async function saveFailure(capsule) {
  const stored = await chrome.storage.session.get(latestFailureKey);
  if ((stored[latestFailureKey]?.end ?? -1) > capsule.end) return;
  await chrome.storage.session.set({ [latestFailureKey]: bounded(capsule) });
}

async function handle({ action, capsule }, sender) {
  const tabId = sender.tab.id;
  const key = armKey(tabId);
  const origin = supportedOrigin(sender.url);

  if (action === 'arm') await chrome.storage.session.set({ [key]: origin });
  if (action === 'disarm') await clearTab(tabId);

  const stored = await chrome.storage.session.get(key);
  const armed = stored[key] === origin;
  if (armed && ['failure', 'checkpoint', 'capture'].includes(action) &&
      supportedOrigin(capsule?.page) === origin) {
    const checkpoints = await getCheckpoints();
    const previous = checkpoints.find(entry => entry.tabId === tabId && entry.origin === origin);
    const combined = stitch(previous?.capsule, capsule);
    if (action === 'capture') return { armed, capsule: bounded(combined) };
    if (action === 'failure') await saveFailure(combined);
    if (action === 'checkpoint' && (!previous || capsule.end >= previous.capsule.end)) {
      const recent = checkpoints.filter(entry =>
        entry.tabId !== tabId && entry.capsule.end >= Date.now() - windowMs);
      recent.push({ tabId, origin, capsule: bounded(combined) });
      await chrome.storage.session.set({ [checkpointKey]: recent.slice(-maxCheckpoints) });
    }
  }
  if (action === 'disarm' || (action === 'recording' && armed)) {
    await chrome.action.setBadgeText({ tabId, text: armed ? 'REC' : '' });
  }
  return { armed };
}

chrome.action.setBadgeBackgroundColor({ color: '#bf394f' }).catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== channel || sender.id !== chrome.runtime.id ||
      !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || !supportedOrigin(sender.url) ||
      !['arm', 'disarm', 'armed', 'recording', 'failure', 'checkpoint', 'capture'].includes(message.action)) return;
  enqueue(() => handle(message, sender))
    .then(respond, () => respond({ error: 'Could not update recording state.' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(() => clearTab(tabId)).catch(console.error);
});
