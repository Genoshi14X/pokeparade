import WebSocket from 'ws';
import type { TwitchStatus } from '../shared.js';

export interface Credentials { clientId: string; accessToken: string; refreshToken: string }
const SCOPES = 'user:read:chat';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { signal.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); reject(new Error('cancelled')); }
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});

export class Twitch {
  status: TwitchStatus = { status: 'offline', message: 'Twitch не подключён' };
  private credentials?: Credentials;
  private socket?: WebSocket;
  private sockets = new Set<WebSocket>();
  private retry?: ReturnType<typeof setTimeout>;
  private validateTimer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private generation = 0;
  private stopped = true;
  private seen = new Set<string>();
  private userId = '';
  private refreshPromise?: Promise<void>;
  constructor(private onMessage: (id: string, name: string, text: string) => void, private persist: (credentials?: Credentials) => Promise<void>, private transport = { fetch: globalThis.fetch, socket: (url: string) => new WebSocket(url) }) {}
  private async request(url: string, init: RequestInit = {}) {
    return this.transport.fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  }
  async authorize(clientId: string) {
    if (!/^[a-zA-Z0-9]{10,100}$/.test(clientId)) throw new Error('Проверь Client ID приложения Twitch.');
    this.stop(); this.credentials = undefined; await this.persist();
    const controller = new AbortController(); this.controller = controller;
    const generation = this.generation;
    this.status = { status: 'authorizing', message: 'Получаем код Twitch…', clientId };
    try {
      const response = await this.request('https://id.twitch.tv/oauth2/device', { method: 'POST', body: new URLSearchParams({ client_id: clientId, scopes: SCOPES }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const data = await response.json() as Record<string, any>;
      if (generation !== this.generation) return;
      if (!response.ok || !data.device_code) throw new Error('Twitch не выдал код. Проверь Client ID и тип приложения Public.');
      this.status = { status: 'authorizing', message: 'Подтверди вход на странице Twitch', clientId, code: data.user_code, verificationUri: 'https://www.twitch.tv/activate', expiresAt: Date.now() + data.expires_in * 1000 };
      void this.poll(clientId, data.device_code, Math.max(5, Number(data.interval) || 5), this.status.expiresAt!, controller, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = { status: 'error', message: error instanceof Error && error.message.startsWith('Twitch') ? error.message : 'Не удалось связаться с Twitch. Проверь интернет и повтори подключение.', clientId };
      throw new Error(this.status.message);
    }
  }
  private async poll(clientId: string, deviceCode: string, interval: number, expiresAt: number, controller: AbortController, generation: number) {
    try {
      while (Date.now() < expiresAt && !controller.signal.aborted) {
        await sleep(interval * 1000, controller.signal);
        const response = await this.request('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, scopes: SCOPES, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json() as Record<string, any>;
        if (generation !== this.generation) return;
        if (response.ok && data.access_token) {
          const credentials = { clientId, accessToken: data.access_token, refreshToken: data.refresh_token };
          await this.persist(credentials); await this.connect(credentials); return;
        }
        const reason = String(data.message ?? data.error ?? '');
        if (/slow_down|slow down/i.test(reason)) { interval += 5; continue; }
        if (/authorization_pending|authorization pending/i.test(reason)) continue;
        throw new Error('Авторизация не завершена. Подключи Twitch ещё раз.');
      }
      if (!controller.signal.aborted) this.status = { status: 'error', message: 'Время ввода кода истекло. Подключи Twitch ещё раз.', clientId };
    } catch {
      if (generation === this.generation && !controller.signal.aborted) this.status = { status: 'error', message: 'Авторизация прервана. Проверь интернет и подключи Twitch ещё раз.', clientId };
    }
  }
  async connect(credentials: Credentials) {
    this.stop(); this.stopped = false; this.credentials = credentials;
    const generation = this.generation;
    this.status = { status: 'connecting', message: 'Подключаемся к чату…', clientId: credentials.clientId };
    try {
      await this.validate(); if (generation !== this.generation) return;
      this.open(EVENTSUB_URL, false, generation);
      this.validateTimer = setInterval(() => { void this.validate().catch(() => { this.fail('Сессия Twitch истекла. Подключи Twitch ещё раз.'); }); }, 50 * 60_000);
    } catch { if (generation === this.generation) this.fail('Не удалось войти в Twitch. Проверь интернет или подключи аккаунт заново.'); }
  }
  private async refresh() {
    if (!this.credentials) throw new Error('No credentials');
    if (this.refreshPromise) return this.refreshPromise;
    const credentials = this.credentials;
    const generation = this.generation;
    this.refreshPromise = (async () => {
      const response = await this.request('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: credentials.clientId, grant_type: 'refresh_token', refresh_token: credentials.refreshToken }) });
      const data = await response.json() as Record<string, any>;
      if (!response.ok || !data.access_token) throw new Error('Refresh failed');
      if (generation !== this.generation) return;
      this.credentials = { ...credentials, accessToken: data.access_token, refreshToken: data.refresh_token ?? credentials.refreshToken };
      await this.persist(this.credentials);
    })().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }
  private async validate() {
    if (!this.credentials) throw new Error('No credentials');
    const generation = this.generation;
    let response = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.credentials.accessToken}` } });
    if (generation !== this.generation) return;
    if (response.status === 401) {
      await this.refresh();
      if (generation !== this.generation) return;
      response = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.credentials!.accessToken}` } });
    }
    const data = await response.json() as Record<string, any>;
    if (generation !== this.generation) return;
    if (!response.ok || !data.scopes?.includes(SCOPES) || data.client_id !== this.credentials?.clientId) throw new Error('Invalid token');
    if (this.stopped) return;
    this.userId = data.user_id;
    this.status = { ...this.status, login: data.login, clientId: this.credentials.clientId };
    if (data.expires_in < 3600) await this.refresh();
  }
  private open(url: string, migrating: boolean, generation: number) {
    if (this.stopped || generation !== this.generation) return;
    const socket = this.transport.socket(url); this.sockets.add(socket);
    let watchdog: ReturnType<typeof setTimeout>;
    let keepalive = 20_000;
    let welcomed = false;
    let isMigratingAway = false;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => socket.terminate(), keepalive); };
    arm();
    socket.on('message', raw => {
      if (this.stopped || generation !== this.generation) return;
      arm();
      void (async () => {
        const message = JSON.parse(raw.toString());
        const kind = message.metadata?.message_type;
        if (kind === 'session_welcome') {
          welcomed = true;
          keepalive = ((message.payload.session.keepalive_timeout_seconds || 20) + 5) * 1000; arm();
          if (!migrating) {
            await this.validate();
            if (generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
            const response = await this.request('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { Authorization: `Bearer ${this.credentials!.accessToken}`, 'Client-Id': this.credentials!.clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.userId, user_id: this.userId }, transport: { method: 'websocket', session_id: message.payload.session.id } }) });
            if (!response.ok) throw new Error('Subscribe failed');
          }
          if (generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
          const previous = this.socket; this.socket = socket;
          if (previous && previous !== socket) previous.close();
          this.status = { status: 'connected', message: 'Чат подключён', login: this.status.login, clientId: this.credentials!.clientId };
        } else if (kind === 'session_reconnect') {
          const next = new URL(message.payload.session.reconnect_url);
          if (next.protocol !== 'wss:' || next.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Invalid reconnect');
          isMigratingAway = true; this.open(next.href, true, generation);
        } else if (kind === 'revocation') {
          this.fail('Twitch отозвал доступ к чату. Подключи аккаунт ещё раз.');
        } else if (kind === 'notification' && message.metadata.subscription_type === 'channel.chat.message') {
          const id = message.metadata.message_id;
          if (this.seen.has(id)) return;
          this.seen.add(id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
          const event = message.payload.event;
          // Shared-chat participants from other channels should not join this scene.
          if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.userId) return;
          this.onMessage(event.chatter_user_id, event.chatter_user_name, event.message.text);
        }
      })().catch(() => { if (generation === this.generation) this.fail('Не удалось подключить чат Twitch. Подключи аккаунт заново.'); });
    });
    socket.on('error', () => {}); // close performs bounded reconnect; never print credentials.
    socket.on('close', () => {
      clearTimeout(watchdog); this.sockets.delete(socket);
      if (this.stopped || generation !== this.generation || (isMigratingAway && this.sockets.size > 0) || (this.socket !== socket && this.sockets.size > 0)) return;
      this.status = { ...this.status, status: 'connecting', message: welcomed ? 'Связь с чатом потеряна. Переподключаемся…' : 'Twitch недоступен. Повторяем подключение…' };
      clearTimeout(this.retry);
      this.retry = setTimeout(() => { this.open(EVENTSUB_URL, false, generation); }, 5000);
    });
  }
  private fail(message: string) {
    const { login, clientId } = this.status; this.stop();
    this.status = { status: 'error', message, login, clientId };
  }
  stop() {
    this.stopped = true; this.generation++;
    this.controller?.abort(); clearTimeout(this.retry); clearInterval(this.validateTimer);
    for (const socket of this.sockets) socket.close(); this.sockets.clear(); this.socket = undefined;
  }
  async logout() {
    this.stop(); this.credentials = undefined; this.seen.clear();
    await this.persist(); this.status = { status: 'offline', message: 'Twitch отключён' };
  }
}
