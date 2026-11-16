import { connect, type State } from './connection.js';
import type { Settings } from '../shared.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let state: State | undefined;
let toastTimer: ReturnType<typeof setTimeout>;
let playerKey = '';
let settingsInitialized = false;
let settingsTimer: ReturnType<typeof setTimeout>;
let applyingSettings = false;
const overlayUrl = `${location.origin}/overlay`;
$('overlay-url').textContent = overlayUrl;
const catalogDialog = $<HTMLDialogElement>('catalog-dialog');
let catalogTarget: string | undefined;
let catalogKey = '';
let choosing = false;

function openCatalog(id?: string) {
  if (!state) { toast('Сцена ещё подключается. Попробуй открыть каталог через несколько секунд.'); return; }
  catalogTarget = id;
  const player = state.players.find(p => p.id === id);
  $('catalog-title').textContent = player ? `Покемон для ${player.name}` : 'Выбери покемона';
  $('catalog-hint').textContent = player ? 'Нажми на покемона — персонаж на сцене сразу изменится.' : 'Нажми на покемона, чтобы получить команду для чата.';
  document.querySelector<HTMLElement>('.catalog-command-row')!.hidden = !!id;
  $<HTMLInputElement>('catalog-search').value = '';
  $<HTMLSelectElement>('catalog-generation').value = 'all'; $<HTMLSelectElement>('catalog-variant').value = 'normal';
  renderCatalog(); filterCatalog(); catalogDialog.showModal();
}
function filterCatalog() {
  const search = $<HTMLInputElement>('catalog-search').value.trim().toLowerCase().replace(/^#/, '');
  const generation = $<HTMLSelectElement>('catalog-generation').value;
  const variant = $<HTMLSelectElement>('catalog-variant').value;
  let count = 0;
  for (const item of Array.from($('catalog-grid').children)) {
    const button = item as HTMLButtonElement;
    const matchesSearch = /^\d+$/.test(search) ? Number(button.dataset.dex) === Number(search) : button.dataset.search!.includes(search);
    button.hidden = !matchesSearch || (generation !== 'all' && button.dataset.generation !== generation) || (variant !== 'all' && button.dataset.shiny !== String(variant === 'shiny'));
    if (!button.hidden) count++;
  }
  $('catalog-empty').hidden = count > 0;
}
function renderCatalog() {
  if (!state) return;
  const key = JSON.stringify(state.skins.map(s => [s.id, s.name, s.preview, s.generation, s.shiny]));
  if (catalogKey === key) return;
  catalogKey = key; const grid = $('catalog-grid'); grid.replaceChildren();
  for (const skin of state.skins) {
    const button = document.createElement('button'); button.className = 'catalog-item'; button.type = 'button'; button.setAttribute('aria-pressed', 'false');
    button.dataset.search = `${skin.id} ${skin.name}`.toLowerCase(); button.dataset.dex = String(skin.dexNumber || '');
    button.dataset.generation = String(skin.generation || ''); button.dataset.shiny = String(!!skin.shiny);
    button.classList.toggle('shiny', !!skin.shiny);
    if (skin.preview) { const image = document.createElement('img'); image.src = skin.preview; image.alt = ''; image.loading = 'lazy'; button.append(image); }
    const number = document.createElement('small'); number.textContent = (skin.dexNumber ? `#${String(skin.dexNumber).padStart(3, '0')}` : skin.id) + (skin.shiny ? ' · SHINY' : '');
    const name = document.createElement('strong'); name.textContent = skin.name;
    button.append(number, name);
    button.onclick = async () => {
      if (catalogTarget) {
        if (choosing) return;
        choosing = true; button.disabled = true;
        try { await api('skin', { id: catalogTarget, skin: skin.id }); catalogDialog.close(); }
        catch (error) { toast(error instanceof Error ? error.message : 'Не удалось сменить покемона. Повтори выбор.', true); }
        finally { choosing = false; button.disabled = false; }
      } else {
        $<HTMLInputElement>('catalog-command').value = `!skin ${skin.dexNumber || skin.id}`;
        $('catalog-hint').textContent = skin.shiny ? 'Shiny может выпасть по команде с номером. Результат зависит от шанса в настройках сцены.' : 'Скопируй команду в чат. При выборе по номеру есть шанс получить shiny.';
        for (const card of Array.from(grid.children)) card.setAttribute('aria-pressed', String(card === button));
      }
    };
    grid.append(button);
  }
}
$('open-catalog').addEventListener('click', () => openCatalog());
$('close-catalog').addEventListener('click', () => catalogDialog.close());
$('catalog-search').addEventListener('input', filterCatalog);
$('catalog-generation').addEventListener('change', filterCatalog);
$('catalog-variant').addEventListener('change', filterCatalog);
action('copy-skin-command', async () => {
  const input = $<HTMLInputElement>('catalog-command');
  try { await navigator.clipboard.writeText(input.value); toast('Команда скопирована. Её можно отправить в чат Twitch.'); }
  catch { input.select(); toast('Команда выделена. Нажми Ctrl+C, чтобы скопировать.'); }
});

function toast(message: string, error = false) {
  const box = $('toast'); box.textContent = message; box.className = `toast${error ? ' error' : ''}`; box.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, error ? 7000 : 3000);
}
async function api(path: string, body: unknown = {}) {
  let response: Response;
  try { response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error('Не удалось связаться со сценой. Проверь, что приложение запущено, и повтори действие.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить действие. Попробуй ещё раз.');
  render(result); return result as State;
}
function action(id: string, callback: () => Promise<unknown>) {
  $(id).addEventListener('click', async () => {
    const button = $<HTMLButtonElement>(id); button.disabled = true;
    try { await callback(); } catch (error) { toast(error instanceof Error ? error.message : 'Сцена недоступна. Проверь, что приложение запущено.', true); }
    finally { button.disabled = false; }
  });
}
action('first-demo', () => api('demo', { count: 5 }));
action('add-demo', () => api('demo', { count: 5 }));
action('fill-demo', () => api('demo', { count: 40 }));
action('clear-demo', () => api('clear', { demoOnly: true }));
action('pause', () => api('pause', { paused: !state?.paused }));
action('dance-all', () => api('action', { command: '!dance' }));
action('disconnect-twitch', () => api('twitch/disconnect'));
$('open-overlay').addEventListener('click', () => window.open(overlayUrl, '_blank', 'noopener,noreferrer'));
$('background').addEventListener('click', () => $('preview').classList.toggle('light'));
action('copy-url', async () => {
  try { await navigator.clipboard.writeText(overlayUrl); toast('Ссылка скопирована. Вставь её в источник браузера OBS.'); }
  catch { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('overlay-url')); selection?.removeAllRanges(); selection?.addRange(range); toast('Ссылка выделена. Нажми Ctrl+C, чтобы скопировать.'); }
});
const clearDialog = $<HTMLDialogElement>('clear-dialog');
$('clear-all').addEventListener('click', () => clearDialog.showModal());
$('cancel-clear').addEventListener('click', () => clearDialog.close());
action('confirm-clear', async () => { await api('clear'); clearDialog.close(); });

$('twitch-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $<HTMLButtonElement>('connect-twitch'); button.disabled = true; button.textContent = 'Получаем код…';
  try { await api('twitch/connect', { clientId: $<HTMLInputElement>('client-id').value }); }
  catch (error) { toast(error instanceof Error ? error.message : 'Не удалось подключить Twitch.', true); }
  finally { button.disabled = false; button.innerHTML = 'Подключить Twitch <span>↗</span>'; }
});

function settingLabels() {
  for (const id of ['size', 'speed', 'bottom']) $(id + '-output').textContent = $<HTMLInputElement>(id).value + (id === 'speed' ? '' : ' px');
  const odds = Number($<HTMLInputElement>('shinyOdds').value);
  $('shiny-chance').textContent = odds > 0 ? `1 из ${odds} (${(100 / odds).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %). Только для !skin число.` : 'Случайные shiny отключены.';
}
function readSettings(): Settings {
  return { size: Number($<HTMLInputElement>('size').value), speed: Number($<HTMLInputElement>('speed').value), bottom: Number($<HTMLInputElement>('bottom').value), names: $<HTMLInputElement>('names').checked, autoJoin: $<HTMLInputElement>('autoJoin').checked, idleMinutes: Number($<HTMLSelectElement>('idleMinutes').value), fps: Number($<HTMLSelectElement>('fps').value), shinyOdds: Number($<HTMLInputElement>('shinyOdds').value) };
}
let pendingSettings: Settings | undefined;
async function saveSettings() {
  if (applyingSettings || !pendingSettings) return;
  const settings = pendingSettings; pendingSettings = undefined; applyingSettings = true;
  try { await api('settings', settings); $('save-note').textContent = 'Настройки сохранены'; }
  catch { $('save-note').textContent = 'Не удалось сохранить. Измени настройку, чтобы повторить.'; toast('Настройки не сохранены. Проверь, что приложение запущено.', true); }
  finally { applyingSettings = false; if (pendingSettings) void saveSettings(); }
}
$('settings-form').addEventListener('input', () => {
  settingLabels(); clearTimeout(settingsTimer); pendingSettings = readSettings(); $('save-note').textContent = 'Сохраняем…';
  settingsTimer = setTimeout(() => { void saveSettings(); }, 120);
});
$('settings-form').addEventListener('submit', event => event.preventDefault());

function renderPlayers(next: State) {
  const key = JSON.stringify([next.players.map(p => [p.id, p.name, p.skin]), next.queue]);
  if (key === playerKey) return; playerKey = key;
  const list = $('player-list'); list.replaceChildren();
  for (const p of next.players) {
    const skin = next.skins.find(s => s.id === p.skin);
    const item = document.createElement('div'); item.className = `player${skin?.shiny ? ' shiny' : ''}`;
    const face = document.createElement('button'); face.type = 'button'; face.className = 'player-face'; face.style.setProperty('--skin', skin?.color || '#b3ed85');
    face.title = `Сменить персонажа для ${p.name}`; face.setAttribute('aria-label', face.title); face.onclick = () => openCatalog(p.id);
    if (skin?.preview) { const image = document.createElement('img'); image.src = skin.preview; image.alt = skin.name; face.append(image); face.classList.add('pokemon-face'); }
    else face.textContent = '••';
    const info = document.createElement('div'); info.className = 'player-info';
    const name = document.createElement('strong'); name.textContent = p.name; name.title = p.name;
    const caption = document.createElement('small'); caption.textContent = `${p.demo ? 'Тест · ' : ''}${skin?.name || p.skin}`;
    info.append(name, caption);
    const remove = document.createElement('button'); remove.className = 'remove-player'; remove.textContent = '×'; remove.title = `Убрать ${p.name}`; remove.setAttribute('aria-label', remove.title);
    remove.onclick = () => { void api('remove', { id: p.id }).catch(() => toast('Не удалось убрать персонажа. Попробуй ещё раз.', true)); };
    item.append(face, info, remove); list.append(item);
  }
  $('queue-panel').hidden = !next.queue.length;
  $('queue-names').textContent = next.queue.map(p => p.name).join(', ');
}
function render(next: State) {
  state = next;
  for (const id of ['count', 'participant-count', 'nav-count']) $(id).textContent = String(next.players.length);
  $('queue-count').textContent = next.queue.length ? `· ${next.queue.length} в очереди` : '';
  $('preview-empty').hidden = next.players.length > 0;
  $('participants-empty').hidden = next.players.length > 0;
  $('scene-status').textContent = next.paused ? 'НА ПАУЗЕ' : 'СЦЕНА АКТИВНА';
  $('scene-status').classList.toggle('paused', next.paused);
  $('pause').innerHTML = next.paused ? '▷ <span>Продолжить</span>' : 'Ⅱ <span>Пауза</span>';
  $('pause').title = next.paused ? 'Продолжить движение' : 'Приостановить движение';
  $('clear-all').toggleAttribute('disabled', !next.players.length && !next.queue.length);
  const twitch = next.twitch;
  const connected = twitch.status === 'connected';
  const authorizing = twitch.status === 'authorizing';
  const labels = { offline: 'НЕ ПОДКЛЮЧЁН', authorizing: 'АВТОРИЗАЦИЯ', connecting: 'ПОДКЛЮЧЕНИЕ', connected: 'ПОДКЛЮЧЁН', error: 'НЕТ ПОДКЛЮЧЕНИЯ' };
  $('twitch-label').textContent = labels[twitch.status]; $('twitch-label').classList.toggle('connected', connected);
  $('twitch-description').textContent = connected ? `Канал ${twitch.login}. Зрители могут присоединиться командой !join.` : twitch.status === 'offline' ? 'Подключи канал, чтобы зрители могли присоединяться из чата.' : twitch.message;
  $('twitch-form').hidden = connected || authorizing || twitch.status === 'connecting';
  $('device-auth').hidden = !authorizing || !twitch.code;
  $('device-code').textContent = twitch.code || '';
  $('device-expiry').textContent = twitch.expiresAt ? `Код действует ещё ${Math.max(0, Math.ceil((twitch.expiresAt - Date.now()) / 60_000))} мин. После подтверждения чат подключится автоматически.` : '';
  $('disconnect-twitch').hidden = twitch.status === 'offline';
  $('disconnect-twitch').textContent = authorizing ? 'Отменить вход' : 'Отключить Twitch';
  if (!settingsInitialized) {
    settingsInitialized = true;
    for (const [key, value] of Object.entries(next.settings)) {
      const input = $<HTMLInputElement>(key);
      if (typeof value === 'boolean') input.checked = value; else input.value = String(value);
    }
    if (twitch.clientId) $<HTMLInputElement>('client-id').value = twitch.clientId;
    const command = document.querySelector('.commands-bar>div:last-child code'); if (command) command.textContent = next.skins.some(s => s.id === 'pikachu') ? '!skin 25' : `!skin 1–${next.skins.length}`;
    const regularCount = next.skins.filter(s => !s.shiny).length;
    const shinyCount = next.skins.filter(s => s.shiny).length;
    $('catalog-description').textContent = `${regularCount} покемона · ${shinyCount} shiny. Нажми на портрет участника, чтобы сменить его персонажа.`;
    settingLabels();
  }
  renderPlayers(next);
}
connect(render, connected => {
  $('server-dot').style.background = connected ? '#b3ed85' : '#edbd85';
  $('server-status').textContent = connected ? 'Приложение запущено' : 'Переподключаемся…';
});
