import { replayBudget, windowMs } from './protocol.js';

// rrweb event types stored in version 1 capsules.
const fullSnapshot = 2;
const meta = 4;

function trimReplay(events, start) {
  const snapshots = [];
  let first = 0;
  for (const [index, event] of events.entries()) {
    if (event.type !== fullSnapshot) continue;
    if (event.timestamp <= start) first = snapshots.length;
    snapshots.push(events[index - 1]?.type === meta ? index - 1 : index);
  }
  for (const index of snapshots.slice(first)) {
    const replay = events.slice(index);
    if (replay.length <= 50_000 && JSON.stringify(replay).length <= replayBudget) return replay;
  }
  return [];
}

export function stitch(previous, current) {
  const cutoff = current.end - windowMs;
  if (!previous || previous.end < cutoff || previous.end > current.start) return current;

  const start = Math.max(previous.start, cutoff);
  const rows = [...previous.rows, ...current.rows]
    .filter(row => row.at >= start)
    .slice(-400)
    .map((row, index) => ({ ...row, id: index + 1 }));
  return {
    ...current,
    start,
    rows,
    replay: trimReplay([...previous.replay, ...current.replay], start)
  };
}
