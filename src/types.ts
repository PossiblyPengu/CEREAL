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

// ─── Electron API (exposed via preload) ──────────────────────────────────────

export interface ElectronAPI {
  getGames(): Promise<Game[]>;
  saveGames(games: Game[]): Promise<void>;
  getCategories(): Promise<string[]>;
  saveCategories(cats: string[]): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;
  launchGame(gameId: string): Promise<{ success: boolean; error?: string; lastPlayed?: string }>;
  addGame(game: Game): Promise<Game>;
  updateGame(game: Game): Promise<Game>;
  deleteGame(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<Game>;
  openFileDialog(opts?: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openFolderDialog(): Promise<string | null>;
  signalReady?(): void;
  onChiakiEvent?(cb: (evt: ChiakiSession) => void): () => void;
  onGamesRefresh?(cb: (games: Game[]) => void): () => void;
  detectGames?(platform: string): Promise<Game[]>;
  fetchSgdbCovers?(gameId: string, query: string): Promise<{ url: string; thumbUrl?: string }[]>;
  downloadCover?(gameId: string, url: string): Promise<{ localPath: string }>;
  startChiaki?(game: Game, opts?: Record<string, unknown>): Promise<void>;
  stopChiaki?(gameId: string): Promise<void>;
  getChiakiRegistered?(host: string): Promise<boolean>;
  registerChiaki?(host: string, pin: string): Promise<{ success: boolean; error?: string }>;
  [key: string]: unknown;
}

declare global {
  interface Window {
    api?: ElectronAPI;
  }
}
