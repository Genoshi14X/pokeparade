export const WIDTH = 1920;
export const HEIGHT = 1080;
export const MAX_PLAYERS = 40;
export const DEFAULT_SETTINGS: Settings = { size: 72, bottom: 36, speed: 65, names: true, autoJoin: false, idleMinutes: 30, fps: 30, shinyOdds: 128 };
export interface Settings { size: number; bottom: number; speed: number; names: boolean; autoJoin: boolean; idleMinutes: number; fps: number; shinyOdds: number }
export type Action = 'idle' | 'walk' | 'jump' | 'dance';
export interface Player { id: string; name: string; skin: string; x: number; lane: number; direction: number; action: Action; until: number; lastActive: number; demo: boolean }
export interface Profile { skin: string; name: string }
export interface Skin { id: string; name: string; color?: string; image?: string; preview?: string; dexNumber?: number; generation?: number; shiny?: boolean; facing?: 'left' | 'right'; frameWidth?: number; frameHeight?: number; columns?: number; rows?: number; fps?: number; frameDurations?: number[]; animations?: Partial<Record<Action, number[]>> }
export interface SceneState { players: Player[]; queue: { id: string; name: string }[]; settings: Settings; paused: boolean; time: number; skins: Skin[]; revision: number }
export const DEFAULT_SKINS: Skin[] = [
  { id: 'mint', name: 'Мята', color: '#83e8bb' }, { id: 'peach', name: 'Персик', color: '#ffbc91' },
  { id: 'lilac', name: 'Сирень', color: '#c4a7ff' }, { id: 'sky', name: 'Небо', color: '#92cfff' },
  { id: 'lemon', name: 'Лимон', color: '#f3dc80' }, { id: 'rose', name: 'Роза', color: '#f39ebc' }
];
export interface TwitchStatus { status: 'offline' | 'authorizing' | 'connecting' | 'connected' | 'error'; message: string; login?: string; clientId?: string; code?: string; verificationUri?: string; expiresAt?: number }
