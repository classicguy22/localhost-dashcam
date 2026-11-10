const key = 'saved-captures';
const maxEntries = 8;
const maxBytes = 8_000_000;

export async function manageLibrary({ action, id, name, capsule }) {
  const stored = await chrome.storage.local.get(key);
  const entries = stored[key] ?? [];
  if (action === 'library-list') return { entries };
  if (action === 'library-save') {
    const entry = { id: crypto.randomUUID(), name: name.slice(0, 100), capsule };
    entries.unshift(entry);
    if (entries.length > maxEntries || new TextEncoder().encode(JSON.stringify(entries)).length > maxBytes) {
      return { error: 'The library is full. Delete a saved capture before adding another.' };
    }
  } else {
    const index = entries.findIndex(entry => entry.id === id);
    if (index === -1) return { error: 'This capture is no longer in the library.' };
    if (action === 'library-delete') entries.splice(index, 1);
    else entries[index].name = name.slice(0, 100);
  }
  await chrome.storage.local.set({ [key]: entries });
  return { entries };
}
