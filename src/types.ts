// ─── Toast / flash plumbing ──────────────────────────────────────────────────

import type { ReactNode } from 'react';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface FlashOptions {
  severity?: ToastSeverity;
  /** Milliseconds before auto-dismiss. Falls back to a sane default per severity. */
  duration?: number;
  /** Optional action button on the toast (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
}

/**
 * Application-wide toast emitter. Backwards-compatible with the original
 * `(msg) => void` signature; new call sites pass an options object for severity,
 * an "Undo"-style action button, or a custom duration.
 */
export type FlashFn = (msg: ReactNode, opts?: FlashOptions) => void;

// ─── Game ────────────────────────────────────────────────────────────────────

export interface Game {
  id: string;
  name: string;
  platform: string;
  platformId?: string;
  coverUrl?: string;
  headerUrl?: string;
  sgdbCoverUrl?: string;
  localCoverPath?: string;
  localHeaderPath?: string;
  _imgStamp?: number;
  categories?: string[];
  playtimeMinutes?: number;
  lastPlayed?: string;
  addedAt?: string;
  favorite?: boolean;
  hidden?: boolean;
  isCustom?: boolean;
  installed?: boolean;

  // Custom/executable games
  executablePath?: string;

  // PlayStation / Chiaki
  chiakiNickname?: string;
  chiakiHost?: string;
  chiakiProfile?: string;
  chiakiFullscreen?: boolean;
  chiakiConsoleId?: string;

  // Xbox Cloud Gaming
  /**
   * Manual override for the launch URL — power-user / "I know what URL to open" escape hatch.
   * If unset, the launch path consults `xcloudProductId` via the Game Pass catalog instead.
   */
  streamUrl?: string;
  /** True if this title appears in the Xbox Cloud Gaming catalog (set during Xbox library import / refresh). */
  xcloudPlayable?: boolean;
  /** Microsoft Store big-catalog product ID used to deep-link into xbox.com/play/launch. */
  xcloudProductId?: string;
  /** SEO slug from the Store catalog — purely decorative for the launch URL but lets shares look pretty. */
  xcloudSlug?: string;
  /** True if the title is currently included in Game Pass (`gamePass.isGamePass` from titlehub). */
  gamePassIncluded?: boolean;

  // Xbox local (UWP / Microsoft Store) launch metadata. Captured by
  // scanXboxInstalled when parsing MicrosoftGame.config and matching the
  // package against `%LOCALAPPDATA%\Packages\`. Used by main.js to launch
  // locally-installed Xbox app games via `shell:AppsFolder\<AUMID>` instead
  // of always streaming them through Xbox Cloud Gaming.
  /** Application User Model ID — `<PackageFamilyName>!<ExecutableId>`. */
  xboxAumid?: string;
  /** Bare PFN, kept separate for diagnostics + Xbox app deep-links. */
  xboxPfn?: string;
  /** Microsoft Game Identity Name (without the publisher-id hash suffix). */
  xboxIdentityName?: string;
  /** Hex titleId from MicrosoftGame.config (e.g. `0x9DDA0000`). The decimal form lives in `platformId`. */
  xboxTitleIdHex?: string;

  // Steam-specific dynamic fields
  software?: boolean;
  type?: string;

  // Metadata
  website?: string;
  description?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  metacritic?: number;
  notes?: string;
  screenshots?: string[];
  videoUrl?: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  defaultView?: 'orbit' | 'cards';
  theme?: string;
  accentColor?: string;
  navPosition?: 'top' | 'bottom' | 'left' | 'right';
  uiScale?: string;
  starDensity?: 'low' | 'normal' | 'high';
  showAnimations?: boolean;
  autoSyncPlaytime?: boolean;
  minimizeOnLaunch?: boolean;
  closeToTray?: boolean;
  defaultTab?: string;
  discordPresence?: boolean;
  metadataSource?: string;
  toolbarPosition?: 'top' | 'bottom' | 'left' | 'right';
  sgdbApiKey?: string;
  steamPath?: string;
  epicPath?: string;
  gogPath?: string;
  xboxPath?: string;
  firstRun?: boolean;
  filterPlatforms?: string[];
  filterCategories?: string[];
  filterHideSteamSoftware?: boolean;
  filterShowHidden?: boolean;
  filterSortBy?: string;
  chiakiPath?: string;
  /** Saved PSN Account ID (Base64) so users don't have to re-enter it on every console registration. */
  psnAccountId?: string;
  // Window & tray behaviour
  minimizeToTray?: boolean;
  startMinimized?: boolean;
  rememberWindowBounds?: boolean;
  windowBounds?: { x?: number; y?: number; width?: number; height?: number; isMaximized?: boolean };
  // Bookkeeping
  launchOnStartup?: boolean;
  // Any additional persisted keys
  [key: string]: unknown;
}

// ─── Theme ───────────────────────────────────────────────────────────────────

export interface Theme {
  label: string;
  accent: string;
  void: string;
  surface: string;
  card: string;
  cardUp: string;
  text: string;
  text2: string;
  text3: string;
  text4: string;
  glass: string;
  glassBorder: string;
  glow: string;
  bodyBg: string;
  preview: [string, string, string, string];
}

// ─── Platform ────────────────────────────────────────────────────────────────

export interface Platform {
  label: string;
  letter: string;
  color: string;
  icon: React.ReactNode;
}

// ─── Camera (galaxy view) ────────────────────────────────────────────────────

export interface Camera {
  zoom: number;
  x: number;
  y: number;
}

// ─── Chiaki session ──────────────────────────────────────────────────────────

export interface ChiakiSession {
  type?: string;
  gameId?: string;
  gameName?: string;
  detectedTitle?: string;
  detectedGameId?: string;
  reason?: string;
  [key: string]: unknown;
}

// ─── Media info (SMTC) ───────────────────────────────────────────────────────

export interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  albumArtUrl?: string;
  isPlaying?: boolean;
  position?: number;
  duration?: number;
}

// ─── Progress overlays ──────────────────────────────────────────────────────

export interface ImportProgress {
  status: 'running' | 'done' | 'error' | string;
  provider?: string;
  processed?: number;
  total?: number;
  imported?: number;
  updated?: number;
  name?: string;
  message?: string;
}

export interface MetaProgress {
  phase: 'metadata' | 'covers' | 'done';
  current?: number;
  total?: number;
  updated?: number;
  failed?: number;
  name?: string;
  coverTotal?: number;
  coverRemaining?: number;
}

export interface CoverProgress {
  remaining: number;
  done: boolean;
}

// ─── Art picker ───────────────────────────────────────────────────────────────

export interface ArtPickerOpts {
  gameName: string;
  platform: string;
  field: 'coverUrl' | 'headerUrl';
}

// ─── IPC result types ────────────────────────────────────────────────────────
// Most main-process IPC handlers return either a typed value or a discriminated
// `{ ok: true, ... }` / `{ ok: false, error }` envelope. Capture the common
// shapes here so call sites can drop their `as any` casts.

export interface IpcOk { ok: true; }
export interface IpcErr { ok: false; error: string; }
export type IpcResult<T = unknown> = (IpcOk & T) | IpcErr;

export interface ChiakiStatus {
  status: 'ready' | 'missing' | string;
  version?: string;
  path?: string;
}

export interface ChiakiConsole {
  host: string;
  name?: string;
  type?: string;
  registered?: boolean;
  registKey?: string;
  morning?: string;
  state?: string;
  [key: string]: unknown;
}

export interface ChiakiUpdateResult {
  ok: boolean;
  version?: string;
  error?: string;
  output?: string;
}

export interface ChiakiRegisterResult {
  success: boolean;
  ok?: boolean;
  error?: string;
}

export interface ChiakiDiscoverResult {
  consoles: ChiakiConsole[];
}

export interface ChiakiSessionsResult {
  sessions: Record<string, ChiakiSession>;
}

export interface AccountInfo {
  connected?: boolean;
  displayName?: string;
  gamertag?: string;
  avatarUrl?: string;
  gameCount?: number;
  lastSync?: string;
  /** Xbox-only: how many of the user's library titles are currently in the xCloud catalog. */
  cloudPlayableCount?: number;
  /** Xbox-only: how many of the user's library titles are currently included in Game Pass. */
  gamePassCount?: number;
  [key: string]: unknown;
}
export type AccountsMap = Record<string, AccountInfo>;

export interface PlatformAuthResult {
  success?: boolean;
  error?: string;
  account?: AccountInfo;
}

export interface PlatformImportResult {
  // Older providers return the count, newer ones return the imported list. Renderer
  // accepts either via `Array.isArray(imported) ? imported.length : imported`.
  imported?: number | Game[];
  // Some providers also surface a list of games that were updated (playtime sync etc.).
  updated?: Game[];
  // The provider may return a refreshed list of games to merge into the renderer state.
  games?: Game[];
  // 'local' means the provider used local-disk scan (no API key); 'remote' means full library.
  source?: 'local' | 'remote' | string;
  error?: string;
}

export interface XboxDetectResult {
  games?: Game[];
  xboxAppFound?: boolean;
  cloudGamingUrl?: string;
}

export interface ApiKeyInfo {
  ok: boolean;
  hasSecret?: boolean;
  fingerprint?: string | null;
  error?: string;
}

export interface SystemSpecs {
  ramGb?: number;
  cpuCount?: number;
  cpuModel?: string;
  gpuName?: string;
  platform?: string;
  arch?: string;
}

export interface UpdateEvent {
  type: 'checking-for-update' | 'update-available' | 'update-not-available'
      | 'download-progress' | 'update-downloaded' | 'error' | string;
  data?: unknown;
}

export interface TabOpenedEvent {
  id: string;
  title: string;
  platform: string;
}

// ─── Electron API (exposed via preload) ──────────────────────────────────────

export interface ElectronAPI {
  // Window controls
  minimize?(): Promise<void>;
  maximize?(): Promise<void>;
  close?(): Promise<void>;
  fullscreen?(): Promise<void>;
  openExternal?(url: string): Promise<void>;
  openPath?(path: string): Promise<string>;
  isFullscreen?(): Promise<boolean>;
  signalReady?(): void;

  // Games
  getGames(): Promise<Game[]>;
  addGame(game: Partial<Game>): Promise<Game>;
  updateGame(game: Partial<Game> & { id: string }): Promise<Game>;
  fetchCoverNow?(gameId: string): Promise<void>;
  deleteGame(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<Game>;
  /**
   * Launch a game.
   * - `options.forceCloud: true` routes Xbox launches through xCloud even when
   *   a local UWP install is available. Ignored for non-Xbox platforms.
   */
  launchGame(gameId: string, options?: { forceCloud?: boolean }): Promise<{ success: boolean; error?: string; lastPlayed?: string }>;
  installGame?(id: string): Promise<void>;
  openGameInClient?(id: string): Promise<void>;

  // Platform detection
  detectSteam?(): Promise<{ games: Game[] }>;
  detectEpic?(): Promise<{ games: Game[] }>;
  detectGOG?(): Promise<{ games: Game[] }>;
  detectPSRemote?(): Promise<{ games: Game[] }>;
  detectXbox?(): Promise<XboxDetectResult>;
  detectEA?(): Promise<{ games: Game[] }>;
  detectBattleNet?(): Promise<{ games: Game[] }>;
  detectItchio?(): Promise<{ games: Game[] }>;
  detectUbisoft?(): Promise<{ games: Game[] }>;

  // Chiaki (PlayStation Remote Play)
  getChiakiStatus?(): Promise<ChiakiStatus | null>;
  chiakiCheckUpdate?(): Promise<{ available: boolean; version?: string; error?: string }>;
  chiakiUpdate?(): Promise<ChiakiUpdateResult>;
  // Pass-through config types: the renderer keeps its own internal `ChiakiConfig`
  // shape and the main process accepts whatever JSON-serializable object it gets,
  // so we use a loose object type here.
  getChiakiConfig?(): Promise<object>;
  saveChiakiConfig?(config: object): Promise<void>;
  setChiakiStream?(gameId: string, streamConfig: object): Promise<void>;
  chiakiStartStreamDirect?(opts: object): Promise<{ success?: boolean; error?: string }>;
  chiakiStartStream?(gameId: string): Promise<{ success?: boolean; error?: string }>;
  chiakiStopStream?(gameId: string): Promise<void>;
  chiakiGetSessions?(): Promise<ChiakiSessionsResult>;
  chiakiOpenGui?(): Promise<{ ok?: boolean; error?: string }>;
  chiakiRegisterConsole?(opts: { host: string; psnAccountId: string; pin: string }): Promise<ChiakiRegisterResult>;
  chiakiDiscoverConsoles?(): Promise<ChiakiDiscoverResult>;
  // `morning` is optional because some call sites only have a registKey — the
  // main process tolerates this and falls back to a default wake payload.
  chiakiWakeConsole?(opts: { host: string; credentials: { registKey?: string; morning?: string } }): Promise<ChiakiRegisterResult>;
  chiakiSetStreamBounds?(opts: { gameId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<void>;
  chiakiUninstall?(): Promise<{ ok?: boolean; error?: string }>;

  // xCloud (Xbox Cloud Gaming)
  xcloudStartDirect?(url: string): Promise<{ id?: string; error?: string }>;
  xcloudStart?(opts: { url?: string; gameId?: string }): Promise<{ id?: string; error?: string }>;
  xcloudStop?(gameId: string): Promise<void>;
  xcloudGetSessions?(): Promise<Record<string, { url: string }>>;
  /** Re-evaluate which Xbox library entries are currently streamable. Hits the public Game Pass catalog only. */
  xcloudRefreshCatalog?(): Promise<{ touched?: number; cloudPlayable?: number; total?: number; error?: string }>;

  // Stream events (PS + Xbox)
  onChiakiEvent?(cb: (evt: ChiakiSession) => void): () => void;

  // Game list refresh
  onGamesRefresh?(cb: (games: Game[]) => void): () => void;

  // Dialogs
  pickExecutable?(): Promise<string | null>;
  pickImage?(): Promise<string | null>;

  // Categories
  getCategories(): Promise<string[]>;
  addCategory?(cat: string): Promise<string[]>;
  removeCategory?(cat: string): Promise<string[]>;

  // Metadata
  fetchMetadata?(gameId: string): Promise<Partial<Game> | null>;
  applyMetadata?(gameId: string, force?: boolean): Promise<{ ok: boolean; updated?: boolean; error?: string }>;
  fetchAllMetadata?(): Promise<{ total: number; updated: number; failed: number }>;
  searchArt?(gameName: string, platform: string): Promise<{ covers?: { url: string }[]; heroes?: { url: string }[]; error?: string }>;
  fetchMetadataForName?(name: string, platform: string, platformId?: string): Promise<Partial<Game> | null>;
  steamGridDbLogin?(): Promise<void>;
  readClipboard?(): Promise<string>;
  onMetadataProgress?(cb: (p: Partial<MetaProgress>) => void): () => void;
  onCoverProgress?(cb: (p: CoverProgress) => void): () => void;

  // Playtime
  syncPlaytime?(): Promise<{ games: Game[]; updated: string[] }>;

  // Platform Accounts
  getAccounts?(): Promise<AccountsMap>;
  removeAccount?(platform: string): Promise<void>;
  platformAuth?(platform: string): Promise<PlatformAuthResult>;
  platformImport?(platform: string): Promise<PlatformImportResult>;

  // Import progress
  onImportProgress?(cb: (data: ImportProgress) => void): () => void;

  // Settings
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;
  resetSettings?(): Promise<Settings>;
  exportLibrary?(): Promise<{ ok: boolean; path?: string; error?: string }>;
  importLibrary?(): Promise<{ ok: boolean; imported?: number; error?: string }>;
  clearAllGames?(): Promise<void>;
  clearCovers?(): Promise<void>;
  getDataPath?(): Promise<string>;
  getAppVersion?(): Promise<string>;

  // Auto-Update
  checkForUpdate?(): Promise<{ available: boolean; version?: string }>;
  installUpdate?(): Promise<void>;
  onUpdateEvent?(cb: (e: UpdateEvent) => void): () => void;

  // System media controls (SMTC)
  getMediaInfo?(): Promise<MediaInfo | null>;
  mediaControl?(action: 'play' | 'pause' | 'next' | 'previous' | 'stop' | string): Promise<void>;

  // Secure API key storage
  saveApiKey?(provider: string, apiKey: string): Promise<ApiKeyInfo>;
  getApiKeyInfo?(provider: string): Promise<ApiKeyInfo>;
  deleteApiKey?(provider: string): Promise<{ ok: boolean }>;
  validateApiKey?(provider: string, apiKey: string): Promise<{ ok: boolean; error?: string }>;
  validateStoredApiKey?(provider: string): Promise<{ ok: boolean; error?: string }>;
  getDiscordStatus?(): Promise<{ enabled: boolean; connected?: boolean }>;

  // Tab system
  onTabsOpened?(cb: (d: TabOpenedEvent) => void): () => void;
  onTabsClosed?(cb: (d: { id: string }) => void): () => void;
  switchTab?(id: string): Promise<{ success: boolean }>;
  closeTab?(id: string): Promise<{ success: boolean }>;

  // System specs
  getSystemSpecs?(): Promise<SystemSpecs>;
}

declare global {
  interface Window {
    api?: ElectronAPI;
  }
}
