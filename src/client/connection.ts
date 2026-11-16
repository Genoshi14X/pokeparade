import type { SceneState, TwitchStatus, Skin } from '../shared.js';
export type State = SceneState & { twitch: TwitchStatus };
export function connect(onState: (state: State) => void, onStatus: (connected: boolean) => void = () => {}) {
  let stopped = false;
  let socket: WebSocket;
  let retry: ReturnType<typeof setTimeout>;
  let skins: Skin[] | undefined;
  function open() {
    socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onopen = () => onStatus(true);
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data.skins)) skins = data.skins;
        if (skins) onState({ ...data, skins });
      } catch (error) { console.error('Scene update failed', error); }
    };
    socket.onclose = () => { onStatus(false); if (!stopped) retry = setTimeout(open, 1500); };
    socket.onerror = () => socket.close();
  }
  open();
  return () => { stopped = true; clearTimeout(retry); socket.close(); };
}
