import { channel, supportedOrigin } from './protocol.js';

const armKey = tabId => 'armed-' + tabId;

async function handle(action, sender) {
  const tabId = sender.tab.id;
  const key = armKey(tabId);
  const origin = supportedOrigin(sender.url);

  if (action === 'arm') await chrome.storage.session.set({ [key]: origin });
  if (action === 'disarm') await chrome.storage.session.remove(key);

  const stored = await chrome.storage.session.get(key);
  const armed = stored[key] === origin;
  if (action === 'disarm' || (action === 'recording' && armed)) {
    await chrome.action.setBadgeText({ tabId, text: armed ? 'REC' : '' });
  }
  return { armed };
}

chrome.action.setBadgeBackgroundColor({ color: '#bf394f' }).catch(console.error);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== channel || sender.id !== chrome.runtime.id ||
      !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || !supportedOrigin(sender.url) ||
      !['arm', 'disarm', 'armed', 'recording'].includes(message.action)) return;
  handle(message.action, sender).then(respond, () => respond({ error: 'Could not update recording state.' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(armKey(tabId)).catch(console.error);
});
