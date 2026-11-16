import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { Twitch, type Credentials } from '../src/server/twitch.js';

class Socket extends EventEmitter {
  readyState = 1;
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  message(kind: string, payload: unknown, metadata: Record<string, string> = {}) {
    this.emit('message', Buffer.from(JSON.stringify({ metadata: { message_type: kind, ...metadata }, payload })));
  }
}
const creds: Credentials = { clientId: 'exampleclientid123', accessToken: 'private-token', refreshToken: 'private-refresh' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Timed out waiting for Twitch state');
}
test('subscribes to own channel, handles messages once, ignores other shared channels and transfers reconnect session', async () => {
  const sockets: Socket[] = [], requests: { url: string; init?: RequestInit }[] = [], messages: unknown[] = [];
  const client = new Twitch((...message) => messages.push(message), async () => {}, {
    fetch: (async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return String(url).endsWith('/validate') ? response({ user_id: '123', login: 'streamer', client_id: creds.clientId, scopes: ['user:read:chat'], expires_in: 10000 }) : response({}, 202);
    }) as typeof fetch,
    socket: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; }
  });
  try {
    await client.connect(creds);
    sockets[0].message('session_welcome', { session: { id: 'session-1', keepalive_timeout_seconds: 10 } });
    await until(() => client.status.status === 'connected');
    const subscription = requests.find(r => r.url.includes('/subscriptions'))!;
    const body = JSON.parse(subscription.init!.body as string);
    assert.equal(body.type, 'channel.chat.message'); assert.deepEqual(body.condition, { broadcaster_user_id: '123', user_id: '123' });
    const event = { event: { chatter_user_id: '777', chatter_user_name: 'viewer', message: { text: '!join' } } };
    const metadata = { message_id: 'unique-1', subscription_type: 'channel.chat.message' };
    sockets[0].message('notification', event, metadata); sockets[0].message('notification', event, metadata);
    sockets[0].message('notification', { event: { ...event.event, source_broadcaster_user_id: '999' } }, { ...metadata, message_id: 'unique-2' });
    assert.deepEqual(messages, [['777', 'viewer', '!join']]);
    sockets[0].message('session_reconnect', { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=test' } });
    assert.equal(sockets.length, 2);
    sockets[1].message('session_welcome', { session: { id: 'session-2', keepalive_timeout_seconds: 10 } });
    await until(() => sockets[0].readyState === 3);
    assert.equal(requests.filter(r => r.url.includes('/subscriptions')).length, 1);
    assert.equal(client.status.status, 'connected');
    sockets[1].message('revocation', {}); assert.equal(client.status.status, 'error');
  } finally { client.stop(); }
});
test('public client refresh does not send a secret and rotates saved credentials', async () => {
  let validations = 0; let saved: Credentials | undefined; let refreshBody: URLSearchParams | undefined;
  const client = new Twitch(() => {}, async c => { saved = c; }, {
    fetch: (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/validate')) {
        if (++validations === 1) return response({}, 401);
        return response({ user_id: '123', login: 'streamer', client_id: creds.clientId, scopes: ['user:read:chat'], expires_in: 10000 });
      }
      refreshBody = init!.body as URLSearchParams;
      return response({ access_token: 'new-token', refresh_token: 'new-refresh' });
    }) as typeof fetch,
    socket: () => new Socket() as unknown as WebSocket
  });
  try {
    await client.connect(creds);
    assert.equal(refreshBody!.get('grant_type'), 'refresh_token'); assert.equal(refreshBody!.has('client_secret'), false);
    assert.equal(saved!.accessToken, 'new-token'); assert.equal(saved!.refreshToken, 'new-refresh');
    assert.ok(!JSON.stringify(client.status).includes('new-token'));
    await client.logout(); assert.equal(saved, undefined); assert.equal(client.status.status, 'offline');
  } finally { client.stop(); }
});
test('device auth asks only for chat read permission and can be cancelled', async () => {
  let body: URLSearchParams | undefined;
  const client = new Twitch(() => {}, async () => {}, {
    fetch: (async (_: string, init?: RequestInit) => { body = init!.body as URLSearchParams; return response({ device_code: 'private-device', user_code: 'ABCDEF', expires_in: 600, interval: 5 }); }) as typeof fetch,
    socket: () => new Socket() as unknown as WebSocket
  });
  try {
    await client.authorize(creds.clientId);
    assert.equal(body!.get('scopes'), 'user:read:chat'); assert.equal(client.status.code, 'ABCDEF');
    assert.ok(!JSON.stringify(client.status).includes('private-device'));
    await client.logout(); assert.equal(client.status.status, 'offline');
  } finally { client.stop(); }
});
