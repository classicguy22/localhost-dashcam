import { Replayer } from 'rrweb';

const root = document.querySelector('#player');
let player;
let originTime = 0;
const messageOrigin = window.origin;

function resize() {
  const wrapper = root.querySelector('.replayer-wrapper');
  const frame = wrapper?.querySelector('iframe');
  if (!frame?.width || !frame?.height) return;
  const scale = Math.min(innerWidth / Number(frame.width), innerHeight / Number(frame.height), 1);
  wrapper.style.transform = 'scale(' + scale + ')';
  root.style.width = Math.ceil(Number(frame.width) * scale) + 'px';
  root.style.height = Math.ceil(Number(frame.height) * scale) + 'px';
}

window.addEventListener('resize', resize);
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== messageOrigin) return;
  const { action, events, time } = event.data || {};
  try {
    if (action === 'load') {
      player?.destroy();
      player = undefined;
      root.replaceChildren();
      if (!Array.isArray(events) || events.length < 2) return;
      originTime = events[0].timestamp;
      player = new Replayer(events, {
        root, mouseTail: false, showWarning: false, triggerFocus: false
      });
      root.querySelector('iframe').tabIndex = -1;
      player.on('resize', resize);
    }
    if (player && action === 'play') player.play(Math.max(0, time - originTime));
    if (player && (action === 'load' || action === 'seek')) {
      player.pause(Math.max(0, time - originTime));
      resize();
    }
  } catch (error) {
    console.error(error);
    player?.destroy();
    player = undefined;
    root.textContent = 'This replay could not be displayed.';
    root.style.color = '#ffbdab';
  }
});
parent.postMessage({ action: 'ready' }, messageOrigin === 'null' ? '*' : messageOrigin);
