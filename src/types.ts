// ─── Game ────────────────────────────────────────────────────────────────────

export interface Game {
  id: string;
  name: string;
  platform: string;
  platformId?: string;
  coverUrl?: string;
  headerUrl?: string;
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
  streamUrl?: string;

  // Steam-specific dynamic fields
  software?: boolean;
  type?: string;
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
  firstRun?: boolean;
  filterPlatforms?: string[];
  filterCategories?: string[];
  filterHideSteamSoftware?: boolean;
  chiakiPath?: string;
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
  status: 'running' | 'done' | 'error';
  provider?: string;
  processed?: number;
  total?: number;
  name?: string;
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

// ─── Electron API (exposed via preload) ──────────────────────────────────────

export interface ElectronAPI {
  // Window controls
  minimize?(): void;
  maximize?(): void;
  close?(): void;
  fullscreen?(): Promise<void>;
  openExternal?(url: string): Promise<void>;
  isFullscreen?(): Promise<boolean>;
  signalReady?(): void;

  // Games
  getGames(): Promise<Game[]>;
  addGame(game: Game): Promise<Game>;
  updateGame(game: Game): Promise<Game>;
  fetchCoverNow?(gameId: string): Promise<void>;
  deleteGame(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<Game>;
  launchGame(gameId: string): Promise<{ success: boolean; error?: string; lastPlayed?: string }>;
  installGame?(id: string): Promise<void>;
  openGameInClient?(id: string): Promise<void>;

  // Platform detection
  detectSteam?(): Promise<{ games: Game[] }>;
  detectEpic?(): Promise<{ games: Game[] }>;
  detectGOG?(): Promise<{ games: Game[] }>;
  detectPSRemote?(): Promise<{ games: Game[] }>;
  detectXbox?(): Promise<{ games: Game[] }>;
  detectEA?(): Promise<{ games: Game[] }>;
  detectBattleNet?(): Promise<{ games: Game[] }>;
  detectItchio?(): Promise<{ games: Game[] }>;
  detectUbisoft?(): Promise<{ games: Game[] }>;

  // Chiaki (PlayStation Remote Play)
  getChiakiStatus?(): Promise<unknown>;
  chiakiCheckUpdate?(): Promise<unknown>;
  chiakiUpdate?(): Promise<unknown>;
  getChiakiConfig?(): Promise<unknown>;
  saveChiakiConfig?(config: unknown): Promise<void>;
  setChiakiStream?(gameId: string, streamConfig: unknown): Promise<void>;
  chiakiStartStreamDirect?(opts: unknown): Promise<void>;
  chiakiStartStream?(gameId: string): Promise<void>;
  chiakiStopStream?(gameId: string): Promise<void>;
  chiakiGetSessions?(): Promise<unknown>;
  chiakiOpenGui?(): Promise<void>;
  chiakiRegisterConsole?(opts: unknown): Promise<{ success: boolean; error?: string }>;
  chiakiDiscoverConsoles?(): Promise<unknown>;
  chiakiWakeConsole?(opts: unknown): Promise<void>;
  chiakiSetStreamBounds?(opts: unknown): Promise<void>;

  // xCloud (Xbox Cloud Gaming)
  xcloudStartDirect?(url: string): Promise<void>;
  xcloudStart?(opts: unknown): Promise<void>;
  xcloudStop?(gameId: string): Promise<void>;
  xcloudGetSessions?(): Promise<unknown>;

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
  fetchMetadata?(gameId: string): Promise<unknown>;
  applyMetadata?(gameId: string, force?: boolean): Promise<unknown>;
  fetchAllMetadata?(): Promise<{ total: number; updated: number; failed: number }>;
  searchArt?(gameName: string, platform: string): Promise<unknown>;
  fetchMetadataForName?(name: string, platform: string, platformId?: string): Promise<unknown>;
  steamGridDbLogin?(): Promise<unknown>;
  readClipboard?(): Promise<string>;
  onMetadataProgress?(cb: (p: Partial<MetaProgress>) => void): () => void;
  onCoverProgress?(cb: (p: CoverProgress) => void): () => void;

  // Playtime
  syncPlaytime?(): Promise<{ games: Game[]; updated: string[] }>;

  // Platform Accounts
  getAccounts?(): Promise<unknown>;
  removeAccount?(platform: string): Promise<unknown>;
  platformAuth?(platform: string): Promise<unknown>;
  platformImport?(platform: string): Promise<unknown>;

  // Import progress
  onImportProgress?(cb: (data: ImportProgress) => void): () => void;

  // Settings
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;
  resetSettings?(): Promise<Settings>;
  exportLibrary?(): Promise<unknown>;
  importLibrary?(): Promise<unknown>;
  clearAllGames?(): Promise<void>;
  clearCovers?(): Promise<void>;
  getDataPath?(): Promise<string>;
  getAppVersion?(): Promise<string>;

  // Auto-Update
  checkForUpdate?(): Promise<unknown>;
  installUpdate?(): void;
  onUpdateEvent?(cb: (e: { type: string; data: unknown }) => void): () => void;

  // System media controls (SMTC)
  getMediaInfo?(): Promise<MediaInfo | null>;
  mediaControl?(action: string): Promise<void>;

  // Secure API key storage
  saveApiKey?(provider: string, apiKey: string): Promise<void>;
  getApiKeyInfo?(provider: string): Promise<unknown>;
  deleteApiKey?(provider: string): Promise<void>;
  validateApiKey?(provider: string, apiKey: string): Promise<unknown>;
  validateStoredApiKey?(provider: string): Promise<unknown>;
  getDiscordStatus?(): Promise<unknown>;

  // Tab system
  onTabsOpened?(cb: (d: { id: string; title: string; platform: string }) => void): () => void;
  onTabsClosed?(cb: (d: { id: string }) => void): () => void;
  switchTab?(id: string): void;
  closeTab?(id: string): void;

  // System specs
  getSystemSpecs?(): Promise<unknown>;
}

declare global {
  interface Window {
    api?: ElectronAPI;
  }
}
