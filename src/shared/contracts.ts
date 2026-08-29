export type ProviderId = "terminal" | "codex" | "claude" | "qwen" | "kimi" | "opencode" | "hermes" | "grok";
export type AgentProviderId = Exclude<ProviderId, "terminal">;
export type LimitProviderId = Extract<AgentProviderId, "codex" | "claude" | "qwen" | "kimi" | "opencode" | "grok">;
export type LaunchProfileId = "normal" | "yolo";
export type SessionStatus = "idle" | "working" | "needs_approval" | "unavailable" | "done" | "failed";
export type PaletteId = "sage" | "lilac" | "night";
export type HomeAccentPresetId = "classic" | "warm" | "cool" | "mono" | "custom";
export type CanvasColorId = "sage" | "lilac" | "night" | "sand" | "mist" | "rose" | "slate";
export type CanvasPatternId = "dots" | "grid" | "waves" | "diagonal" | "rings" | "none";
export type LocaleId = "ru" | "en";
export type MediaFit = "cover" | "contain";
export type EdgePanSpeed = "slow" | "normal" | "fast";
export type ZoomSensitivity = "slow" | "normal" | "fast";
export type CanvasWheelCaptureMode = "off" | "always" | "key";
export type BrowserViewportSurface = "native" | "placeholder" | "hidden";
export type FocusActivation = "off" | "single" | "double";
export type ShortcutAction = "home" | "renameWindow";

export interface HomeAccentColors {
  clock: string;
  launcher: string;
  browser: string;
  settings: string;
  media: string;
}

export const DEFAULT_HOME_ACCENT_COLORS: HomeAccentColors = {
  clock: "#D8E1C5",
  launcher: "#B8CF99",
  browser: "#9CC7DC",
  settings: "#D5A2C9",
  media: "#D5A2C9"
};

export const HOME_GRID_MIN_COLUMNS = 12;
export const HOME_GRID_MIN_ROWS = 8;
export const HOME_GRID_MAX_COLUMNS = 48;
export const HOME_GRID_MAX_ROWS = 36;
export const HOME_GRID_CELL_WIDTH = 82;
export const HOME_GRID_CELL_HEIGHT = 72;
export const HOME_GRID_GAP = 18;

export interface HomeGridSize {
  columns: number;
  rows: number;
}

export const DEFAULT_HOME_GRID_SIZE: HomeGridSize = {
  columns: 16,
  rows: 12
};

export type CoreHomeWidgetId =
  | "core.limits"
  | "core.sessions"
  | "core.clock"
  | "core.media"
  | "core.launcher"
  | "core.settings";

export interface HomeWidgetPlacement {
  widgetId: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

export const DEFAULT_HOME_LAYOUT: HomeWidgetPlacement[] = [
  { widgetId: "core.limits", column: 0, row: 0, columnSpan: 7, rowSpan: 3 },
  { widgetId: "core.sessions", column: 7, row: 0, columnSpan: 5, rowSpan: 3 },
  { widgetId: "core.clock", column: 0, row: 3, columnSpan: 9, rowSpan: 3 },
  { widgetId: "core.media", column: 9, row: 3, columnSpan: 3, rowSpan: 3 },
  { widgetId: "core.launcher", column: 0, row: 6, columnSpan: 10, rowSpan: 2 },
  { widgetId: "core.settings", column: 10, row: 6, columnSpan: 2, rowSpan: 2 }
];

export interface ShortcutBindings {
  home: string;
  renameWindow: string;
}

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  home: "Home",
  renameWindow: "F2"
};

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SessionBounds {
  position: Point;
  size: Size;
}

export interface CameraState extends Point {
  zoom: number;
}

export interface AppSettings {
  locale: LocaleId;
  palette: PaletteId;
  homeAccentPreset: HomeAccentPresetId;
  homeAccentColors: HomeAccentColors;
  homeLauncherProviders: AgentProviderId[];
  homeLimitProviders: LimitProviderId[];
  canvasColor: CanvasColorId;
  pattern: CanvasPatternId;
  snapToGrid: boolean;
  invertTerminalWheel: boolean;
  invertCanvasWheel: boolean;
  edgePan: boolean;
  edgePanSpeed: EdgePanSpeed;
  zoomSensitivity: ZoomSensitivity;
  useScrollWheelToZoom: boolean;
  canvasWheelCaptureMode: CanvasWheelCaptureMode;
  canvasWheelOverride: string | null;
  canvasNavigationOverride: string | null;
  focusActivation: FocusActivation;
  hoverFocus: boolean;
  hoverFocusSpeed: EdgePanSpeed;
  showShortcutHints: boolean;
  shortcuts: ShortcutBindings;
  mediaPath: string | null;
  mediaFit: MediaFit;
  lastDirectory: string;
  acknowledgedDangerousProfiles: AgentProviderId[];
  homeGridSize: HomeGridSize;
  homeLayout: HomeWidgetPlacement[];
  pluginCanvas: PluginCanvasInstance[];
  browserCanvas: BrowserCanvasState | null;
  browserAgentAccess: boolean;
  browserShowAgentPresence: boolean;
  browserRestoreTabs: boolean;
}

export interface CreateSessionRequest {
  provider: ProviderId;
  cwd: string;
  profile: LaunchProfileId;
  position: Point;
  title?: string;
}

export const WORKSPACE_SCHEMA_VERSION = 2;
export const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_TERMINAL_SIZE: Size = { width: 700, height: 430 };

export type WorkspaceObjectKind = "terminal" | "group" | "browser" | "plugin";
export type WorkspaceGroupColor = "sage" | "lilac" | "blue" | "sand" | "rose" | "slate";
export type WorkspaceArrangeMode = "grid" | "columns" | "rows";

export interface WorkspaceSummary {
  id: string;
  title: string;
  projectRoot: string;
  objectCount: number;
  updatedAt: number;
}

export interface WorkspaceCatalogSnapshot {
  revision: number;
  activeId: string;
  workspaces: WorkspaceSummary[];
  presets: WorkspacePreset[];
}

export interface WorkspaceCreateInput {
  title: string;
  projectRoot: string;
  presetId?: string;
}

export interface WorkspaceSwitchResult {
  catalog: WorkspaceCatalogSnapshot;
  workspace: WorkspaceDocument;
}

export interface WorkspaceTerminal {
  id: string;
  kind: "terminal";
  actionId: string | null;
  provider: ProviderId;
  profile: LaunchProfileId;
  title: string;
  titleCustomized: boolean;
  cwd: string;
  position: Point;
  size: Size;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceGroup {
  id: string;
  kind: "group";
  title: string;
  color: WorkspaceGroupColor;
  position: Point;
  size: Size;
  memberIds: string[];
  collapsed: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceGroupInput {
  title: string;
  color: WorkspaceGroupColor;
  position: Point;
  size: Size;
  memberIds: string[];
}

export interface WorkspaceGroupUpdate extends Partial<WorkspaceGroupInput> {
  id: string;
  collapsed?: boolean;
  locked?: boolean;
}

export interface WorkspaceSavedView {
  id: string;
  title: string;
  camera: CameraState;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceSavedViewInput {
  title: string;
  camera: CameraState;
}

export interface TerminalTemplate {
  id: string;
  title: string;
  provider: ProviderId;
  profile: LaunchProfileId;
  cwd: string;
  command: string | null;
  size: Size;
  createdAt: number;
  updatedAt: number;
}

export interface TerminalTemplateInput {
  title: string;
  provider: ProviderId;
  profile: LaunchProfileId;
  cwd: string;
  command?: string | null;
  size?: Size;
}

export interface TerminalTemplateUpdate extends Partial<TerminalTemplateInput> {
  id: string;
}

export type ProjectActionRisk = "safe" | "write" | "dangerous";
export type ProjectActionConcurrency = "focus-existing" | "parallel";
export type ProjectActionAgentPolicy = "deny" | "ask" | "allow";
export type ProjectActionSourceKind =
  | "manual"
  | "package-json"
  | "just"
  | "make"
  | "taskfile"
  | "docker-compose"
  | "script";
export type ProjectActionExecution = "shell" | "argv";
export type ProjectActionStepKind = "command" | "http-health" | "tcp-health" | "open-url";
export type ProjectActionStepMode = "task" | "service";

export interface ProjectActionStepDefinition {
  id: string;
  title: string;
  kind: ProjectActionStepKind;
  mode: ProjectActionStepMode;
  execution: ProjectActionExecution;
  command: string;
  executable: string;
  args: string[];
  cwd: string;
  dependsOn: string[];
  timeoutMs: number;
  url: string | null;
  host: string | null;
  port: number | null;
}

export type ProjectActionStepInput = Partial<ProjectActionStepDefinition> & Pick<ProjectActionStepDefinition, "title" | "kind">;

export interface ProjectActionSource {
  kind: ProjectActionSourceKind;
  path: string;
  key: string;
}

export interface ProjectActionDefinition {
  id: string;
  title: string;
  description: string;
  command: string;
  cwd: string;
  risk: ProjectActionRisk;
  concurrency: ProjectActionConcurrency;
  agentPolicy: ProjectActionAgentPolicy;
  steps: ProjectActionStepDefinition[];
  autoGroup: boolean;
  autoArrange: WorkspaceArrangeMode;
  source: ProjectActionSource | null;
  revision: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectActionInput {
  title: string;
  description: string;
  command: string;
  cwd: string;
  risk: ProjectActionRisk;
  concurrency: ProjectActionConcurrency;
  agentPolicy?: ProjectActionAgentPolicy;
  steps?: ProjectActionStepInput[];
  autoGroup?: boolean;
  autoArrange?: WorkspaceArrangeMode;
  source?: ProjectActionSource | null;
  pinned?: boolean;
}

export interface ProjectActionUpdate extends Partial<ProjectActionInput> {
  id: string;
}

export interface RunProjectActionRequest {
  id: string;
  position: Point;
  terminalObjectId?: string;
  requester?: "user" | "agent" | "plugin";
  requesterId?: string;
  approvalToken?: string;
  idempotencyKey?: string;
}

export interface RunProjectActionResult {
  run: ActionRunSnapshot;
  session: SessionSnapshot | null;
  focusedExisting: boolean;
  needsApproval: boolean;
  approvalToken?: string;
}

export type ActionRunStatus =
  | "waiting-approval"
  | "queued"
  | "running"
  | "ready"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ActionStepRunStatus =
  | "pending"
  | "running"
  | "ready"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface ActionStepRunSnapshot {
  stepId: string;
  title: string;
  status: ActionStepRunStatus;
  terminalSessionId: string | null;
  terminalObjectId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  message: string | null;
}

export interface ActionRunSnapshot {
  id: string;
  actionId: string;
  actionRevision: number;
  workspaceId: string;
  requester: "user" | "agent" | "plugin";
  requesterId: string | null;
  status: ActionRunStatus;
  steps: ActionStepRunSnapshot[];
  startedAt: number;
  finishedAt: number | null;
  idempotencyKey: string | null;
}

export interface ActionRunEvent {
  run: ActionRunSnapshot;
}

export interface ActionApprovalRequest {
  token: string;
  actionId: string;
  actionRevision: number;
  requester: "user" | "agent" | "plugin";
  requesterId: string;
  expiresAt: number;
}

export interface ActionApprovalEvent {
  approval: ActionApprovalRequest;
}

export interface DiscoveredAction {
  importId: string;
  input: ProjectActionInput;
  available: boolean;
  message: string | null;
}

export interface ActionDiscoveryResult {
  root: string;
  sources: Array<{ kind: ProjectActionSourceKind; path: string; count: number; error: string | null }>;
  actions: DiscoveredAction[];
}

export interface WorkspaceDocument {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  revision: number;
  title: string;
  projectRoot: string;
  camera: CameraState;
  terminals: WorkspaceTerminal[];
  groups: WorkspaceGroup[];
  savedViews: WorkspaceSavedView[];
  templates: TerminalTemplate[];
  actions: ProjectActionDefinition[];
  actionRuns: ActionRunSnapshot[];
  pluginCanvas: PluginCanvasInstance[];
  browserCanvas: BrowserCanvasState | null;
  updatedAt: number;
}

export interface WorkspacePreset {
  id: string;
  title: string;
  description: string;
  groups: Array<Omit<WorkspaceGroup, "id" | "memberIds" | "createdAt" | "updatedAt">>;
  templates: Array<Omit<TerminalTemplate, "id" | "createdAt" | "updatedAt">>;
  actions: Array<Omit<ProjectActionDefinition, "id" | "createdAt" | "updatedAt" | "source" | "revision">>;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspacePresetInput {
  title: string;
  description: string;
}

export interface WorkspaceEvent {
  workspace: WorkspaceDocument;
}

export interface WorkspaceCatalogEvent {
  catalog: WorkspaceCatalogSnapshot;
}

export interface WorkspaceTerminalBoundsRequest {
  id: string;
  bounds: SessionBounds;
}

export interface SessionMetadata {
  id: string;
  revision: number;
  workspaceId: string;
  workspaceObjectId: string | null;
  actionId: string | null;
  actionRunId: string | null;
  actionStepId: string | null;
  provider: ProviderId;
  profile: LaunchProfileId;
  title: string;
  titleCustomized: boolean;
  cwd: string;
  position: Point;
  size: Size;
  status: SessionStatus;
  startedAt: number;
  exitCode: number | null;
  failureDetails: string | null;
}

export interface SessionSnapshot extends SessionMetadata {
  buffer: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface SessionEvent {
  session: SessionMetadata;
}

export interface SessionRemovedEvent {
  id: string;
}

export interface MediaSelection {
  path: string;
  dataUrl: string;
}

export interface WindowState {
  isMacOS: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

export const PLUGIN_API_VERSION = 1;

export type PluginPermission =
  | "storage"
  | "secrets"
  | "sessions:read"
  | "limits:read"
  | "launcher:open"
  | "external:open"
  | "browser:open"
  | "media:library"
  | "playlists:read"
  | "playlists:write"
  | "hermes:hud"
  | "actions:read"
  | "actions:run-approved"
  | "network";

export type HermesHudSnapshot =
  | { state: "unavailable"; reason: "cli-not-found"; message: string }
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "stopping" }
  | { state: "running"; hudOpen: boolean }
  | { state: "error"; message: string };

export interface PluginGridSize extends HomeGridSize {}

export interface PluginContributionBase {
  id: string;
  title: string;
  description?: string;
  entry: string;
  icon?: string;
  module?: string;
}

export interface PluginModuleAsset {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PluginModule {
  id: string;
  title: string;
  description?: string;
  defaultSelected: boolean;
  permissions: PluginPermission[];
  files: PluginModuleAsset[];
}

export interface PluginHomeWidgetContribution extends PluginContributionBase {
  kind: "home-widget";
  defaultSize: PluginGridSize;
}

export interface PluginCanvasAppContribution extends PluginContributionBase {
  kind: "canvas-app";
  defaultSize: Size;
  minSize?: Size;
}

export interface PluginWindowContribution extends PluginContributionBase {
  kind: "window";
  defaultSize: Size;
  minSize?: Size;
}

export type PluginContribution =
  | PluginHomeWidgetContribution
  | PluginCanvasAppContribution
  | PluginWindowContribution;

export interface PluginManifest {
  apiVersion: typeof PLUGIN_API_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  /** Optional icon path inside the package root (defaults to `icon.png`). */
  icon?: string;
  /** Russian description override (shown when locale is ru). */
  "description.ru"?: string;
  /** English description override (shown when locale is en). */
  "description.en"?: string;
  author?: string;
  homepage?: string;
  /** Platforms this plugin declares support for (e.g. `["canvastty"]`).
   *  Absent = compatible with every platform (legacy). */
  platforms?: string[];
  /** Minimal host (CanvasTTY) version this plugin is written for, semver.
   *  Informational only; newer requirements are surfaced but do not block. */
  minHostVersion?: string;
  permissions: PluginPermission[];
  contributions: PluginContribution[];
  settingsContribution?: string;
  coreFiles?: PluginModuleAsset[];
  modules?: PluginModule[];
}

export interface GithubPluginSearchResult {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  updatedAt: string;
  /** Minimal host version declared in the plugin manifest (semver). */
  minHostVersion?: string;
}

export interface PluginUpdateStatus {
  pluginId: string;
  installedVersion: string;
  latestVersion: string;
}

export interface GithubAuthStatus {
  configured: boolean;
  authorized: boolean;
  login: string | null;
  tokenExpiresAt: number | null;
}

export interface GithubDeviceFlowStart {
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  sourceUrl: string;
  enabled: boolean;
  installedAt: number;
  selectedModules: string[];
}

export interface PluginInstallPreview {
  token: string;
  sourceUrl: string;
  manifest: PluginManifest;
  expiresAt: number;
}

export interface PluginCanvasInstance {
  id: string;
  pluginId: string;
  contributionId: string;
  title: string;
  position: Point;
  size: Size;
}

export interface PluginSessionInfo {
  id: string;
  provider: ProviderId;
  title: string;
  status: SessionStatus;
  startedAt: number;
  exitCode: number | null;
}

export interface PluginLauncherRequest {
  provider: ProviderId;
}

export interface PluginCanvasRequest {
  pluginId: string;
  contributionId: string;
  sourceCanvasInstanceId?: string;
}

export interface PluginBrowserOpenRequest {
  requestId: string;
  pluginId: string;
  url: string;
}

export interface PluginBrowserOpenResponse {
  requestId: string;
  ok: boolean;
  error?: string;
}

export interface PluginStorageChangeEvent {
  pluginId: string;
  key: string;
  value: unknown;
}

export interface PluginMediaLibrary {
  id: string;
  name: string;
}

export interface PluginMediaTrack {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  streamUrl: string;
}

export interface PluginPlaylistFile {
  id: string;
  name: string;
  relativePath: string;
  size: number;
}

export interface BrowserCanvasState extends SessionBounds {}

export interface BrowserViewportClipBounds extends Size {
  x: number;
  y: number;
}

export interface BrowserViewportBounds extends Size {
  x: number;
  y: number;
  surface: BrowserViewportSurface;
  clipBounds?: BrowserViewportClipBounds;
  canvasScale?: number;
  showAgentPresence?: boolean;
}

export type BrowserTabStatus = "loading" | "ready" | "error" | "crashed";
export type BrowserConnectionState = "connected" | "stale";
export type BrowserAgentProvider = AgentProviderId | "unknown";

export const BROWSER_PROVIDER_COLORS: Record<BrowserAgentProvider, string> = {
  claude: "#D97757",
  codex: "#10A37F",
  qwen: "#6D44E8",
  kimi: "#7C5CFC",
  opencode: "#5A5858",
  hermes: "#D6A700",
  grok: "#111111",
  unknown: "#7A8291"
};

export interface AgentCursorSnapshot {
  x: number;
  y: number;
  updatedAt: number;
}

export interface AgentPresenceSnapshot {
  agentId: string;
  connectionId: string;
  provider: BrowserAgentProvider;
  label: string;
  brandColor: string;
  terminalSessionId: string;
  currentTabId: string | null;
  cursor: AgentCursorSnapshot;
  connectionState: BrowserConnectionState;
  connectedAt: number;
  lastHeartbeatAt: number;
}

export interface BrowserDialogSnapshot {
  tabId: string;
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultPrompt: string;
  openedAt: number;
}

export type BrowserDownloadStatus = "pending" | "progressing" | "completed" | "canceled" | "interrupted";

export interface BrowserDownloadSnapshot {
  id: string;
  tabId: string | null;
  fileName: string;
  savePath: string;
  receivedBytes: number;
  totalBytes: number;
  status: BrowserDownloadStatus;
  startedAt: number;
  completedAt: number | null;
}

export interface BrowserTabSnapshot {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  documentRevision: number;
  status: BrowserTabStatus;
  favicon: string | null;
  agents: AgentPresenceSnapshot[];
  crashState: string | null;
}

export interface BrowserSnapshot {
  tabs: BrowserTabSnapshot[];
  activeTabId: string | null;
  visible: boolean;
  agents: AgentPresenceSnapshot[];
  downloads: BrowserDownloadSnapshot[];
  pendingDialog: BrowserDialogSnapshot | null;
}

export interface BrowserStateEvent {
  snapshot: BrowserSnapshot;
}

export interface BrowserCanvasWheelEvent {
  tabId: string;
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface BrowserCanvasFreezeFrameEvent {
  tabId: string;
  generation: number;
  active: boolean;
  dataUrl: string | null;
}

export interface BrowserCanvasNavigationPointerEvent {
  tabId: string;
  type: "down" | "move" | "up" | "cancel";
  clientX: number;
  clientY: number;
}

export interface CanvasNavigationOverrideStateEvent {
  wheelActive: boolean;
  navigationActive: boolean;
}

export interface BrowserCanvasPointerEvent {
  tabId: string;
  type: "down" | "up" | "enter" | "leave";
  clientX: number;
  clientY: number;
  clickCount: number;
}

export type BrowserErrorCode =
  | "AUTH_INVALID"
  | "BRIDGE_UNAVAILABLE"
  | "TAB_NOT_FOUND"
  | "TAB_CLOSED"
  | "STALE_REF"
  | "INVALID_URL"
  | "NAVIGATION_BLOCKED"
  | "PERMISSION_DENIED"
  | "DIALOG_OPEN"
  | "PATH_DENIED"
  | "TIMEOUT"
  | "CANCELED"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "BROWSER_CRASHED"
  | "AUDIT_UNAVAILABLE";

export interface BrowserError {
  code: BrowserErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export type BrowserActor =
  | {
    kind: "human";
    connectionId: string;
  }
  | {
    kind: "agent";
    agentId: string;
    provider: BrowserAgentProvider;
    terminalSessionId: string;
    connectionId: string;
    cwd: string;
  };

export interface BrowserElementRef {
  ref: string;
  tabId: string;
  frameId: string;
  documentRevision: number;
  backendNodeId: number;
}

export interface BrowserElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserObservedElement {
  ref: BrowserElementRef;
  role: string;
  name: string;
  description: string | null;
  value: string | null;
  bounds: BrowserElementBounds | null;
  disabled: boolean;
  focused: boolean;
  editable: boolean;
}

export interface BrowserObservation {
  untrustedWebContent: true;
  tabId: string;
  url: string;
  title: string;
  documentRevision: number;
  elements: BrowserObservedElement[];
  nextCursor: string | null;
}

export type BrowserCommandType =
  | "browser_list_tabs"
  | "browser_new_tab"
  | "browser_close_tab"
  | "browser_activate_tab"
  | "browser_navigate"
  | "browser_back"
  | "browser_forward"
  | "browser_reload"
  | "browser_observe"
  | "browser_read_page"
  | "browser_screenshot"
  | "browser_click"
  | "browser_hover"
  | "browser_type"
  | "browser_select"
  | "browser_press"
  | "browser_scroll"
  | "browser_drag"
  | "browser_wait_for"
  | "browser_handle_dialog"
  | "browser_download_wait"
  | "browser_upload"
  | "browser_get_activity";

export interface BrowserCommand {
  type: BrowserCommandType;
  requestId: string;
  tabId?: string;
  url?: string;
  ref?: BrowserElementRef | string;
  targetRef?: BrowserElementRef | string;
  text?: string;
  values?: string[];
  key?: string;
  direction?: "up" | "down" | "left" | "right";
  deltaX?: number;
  deltaY?: number;
  timeoutMs?: number;
  condition?: "load" | "network-idle" | "text" | "element" | "url" | "download";
  value?: string;
  accept?: boolean;
  promptText?: string;
  paths?: string[];
  cursor?: string;
  limit?: number;
  expectedRevision?: number;
}

export interface BrowserResult<T = unknown> {
  ok: boolean;
  requestId: string;
  tabId: string | null;
  commandSequence: number;
  revisionBefore: number | null;
  revisionAfter: number | null;
  data?: T;
  error?: BrowserError;
}

export interface BrowserActivityEvent {
  sequence: number;
  timestamp: number;
  requestId: string;
  actorKind: BrowserActor["kind"];
  agentId: string | null;
  provider: BrowserAgentProvider | null;
  terminalSessionId: string | null;
  tabId: string | null;
  origin: string | null;
  operation: BrowserCommandType;
  targetHash: string | null;
  revisionBefore: number | null;
  revisionAfter: number | null;
  durationMs: number;
  ok: boolean;
  errorCode: BrowserErrorCode | null;
}

export interface BrowserActivityStateEvent {
  event: BrowserActivityEvent;
}

export type LimitSource =
  | "codex-app-server"
  | "claude-usage-api"
  | "qwen-cli"
  | "kimi-usage-api"
  | "opencode-go-usage-api"
  | "grok-billing-api";
export type LimitUnavailableReason =
  | "cli-not-found"
  | "not-authenticated"
  | "subscription-required"
  | "unsupported-protocol"
  | "timeout"
  | "protocol-error";

export interface LimitWindow {
  id: string;
  bucketId: string;
  slot: "primary" | "secondary";
  isDefaultBucket: boolean;
  label: string | null;
  usedPercent: number | null;
  used: number | null;
  limit: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export type ProviderLimitsSnapshot =
  | {
    provider: AgentProviderId;
    state: "available";
    source: LimitSource;
    fetchedAt: number;
    windows: LimitWindow[];
  }
  | {
    provider: AgentProviderId;
    state: "stale";
    source: LimitSource;
    fetchedAt: number;
    failedAt: number;
    reason: LimitUnavailableReason;
    windows: LimitWindow[];
  }
  | {
    provider: AgentProviderId;
    state: "unavailable";
    source: LimitSource;
    checkedAt: number;
    reason: LimitUnavailableReason;
  };

export interface LimitsSnapshot {
  fetchedAt: number;
  providers: ProviderLimitsSnapshot[];
}

export interface CanvasTTYApi {
  appVersion(): Promise<string>;
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): void;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  workspace: {
    catalog(): Promise<WorkspaceCatalogSnapshot>;
    get(): Promise<WorkspaceDocument>;
    create(input: WorkspaceCreateInput): Promise<WorkspaceSwitchResult>;
    switch(id: string): Promise<WorkspaceSwitchResult>;
    duplicate(id: string, title?: string): Promise<WorkspaceSwitchResult>;
    delete(id: string): Promise<WorkspaceSwitchResult>;
    rename(title: string): Promise<WorkspaceDocument>;
    setProjectRoot(path: string): Promise<WorkspaceDocument>;
    setCamera(camera: CameraState): Promise<WorkspaceDocument>;
    startTerminal(id: string): Promise<SessionSnapshot>;
    setTerminalBounds(request: WorkspaceTerminalBoundsRequest): Promise<WorkspaceDocument>;
    removeTerminal(id: string): Promise<WorkspaceDocument>;
    setPluginCanvas(instances: PluginCanvasInstance[]): Promise<WorkspaceDocument>;
    setBrowserCanvas(bounds: BrowserCanvasState | null): Promise<WorkspaceDocument>;
    createGroup(input: WorkspaceGroupInput): Promise<WorkspaceDocument>;
    updateGroup(input: WorkspaceGroupUpdate): Promise<WorkspaceDocument>;
    moveGroup(id: string, position: Point): Promise<WorkspaceDocument>;
    removeGroup(id: string, removeMembers?: boolean): Promise<WorkspaceDocument>;
    autoArrange(mode: WorkspaceArrangeMode, objectIds?: string[]): Promise<WorkspaceDocument>;
    saveView(input: WorkspaceSavedViewInput): Promise<WorkspaceDocument>;
    removeView(id: string): Promise<WorkspaceDocument>;
    createTemplate(input: TerminalTemplateInput): Promise<WorkspaceDocument>;
    updateTemplate(input: TerminalTemplateUpdate): Promise<WorkspaceDocument>;
    removeTemplate(id: string): Promise<WorkspaceDocument>;
    runTemplate(id: string, position: Point): Promise<SessionSnapshot>;
    savePreset(input: WorkspacePresetInput): Promise<WorkspaceCatalogSnapshot>;
    removePreset(id: string): Promise<WorkspaceCatalogSnapshot>;
    export(): Promise<string>;
    import(raw: string): Promise<WorkspaceSwitchResult>;
    onChanged(listener: (event: WorkspaceEvent) => void): () => void;
    onCatalogChanged(listener: (event: WorkspaceCatalogEvent) => void): () => void;
  };
  actions: {
    list(): Promise<ProjectActionDefinition[]>;
    runs(): Promise<ActionRunSnapshot[]>;
    create(input: ProjectActionInput): Promise<WorkspaceDocument>;
    update(input: ProjectActionUpdate): Promise<WorkspaceDocument>;
    remove(id: string): Promise<WorkspaceDocument>;
    run(request: RunProjectActionRequest): Promise<RunProjectActionResult>;
    approve(token: string): Promise<RunProjectActionResult>;
    stop(runId: string): Promise<ActionRunSnapshot>;
    retry(runId: string, stepId?: string): Promise<RunProjectActionResult>;
    discover(root: string): Promise<ActionDiscoveryResult>;
    import(inputs: ProjectActionInput[]): Promise<WorkspaceDocument>;
    onRun(listener: (event: ActionRunEvent) => void): () => void;
    onApproval(listener: (event: ActionApprovalEvent) => void): () => void;
  };
  dialog: {
    pickDirectory(defaultPath?: string): Promise<string | null>;
    pickMedia(): Promise<MediaSelection | null>;
  };
  media: {
    read(path: string): Promise<string | null>;
  };
  limits: {
    get(): Promise<LimitsSnapshot>;
  };
  plugins: {
    list(): Promise<InstalledPlugin[]>;
    search(query: string): Promise<GithubPluginSearchResult[]>;
    showcase(): Promise<GithubPluginSearchResult[]>;
    icon(sourceUrls: string[]): Promise<Record<string, string | null>>;
    manifests(sourceUrls: string[]): Promise<Record<string, PluginManifest>>;
    checkUpdates(): Promise<PluginUpdateStatus[]>;
    update(pluginId: string): Promise<InstalledPlugin>;
    onUpdatesAvailable(listener: (updates: PluginUpdateStatus[]) => void): () => void;
    previewInstall(sourceUrl: string): Promise<PluginInstallPreview>;
    install(token: string, selectedModules?: string[]): Promise<InstalledPlugin>;
    setModules(pluginId: string, selectedModules: string[]): Promise<InstalledPlugin>;
    setEnabled(pluginId: string, enabled: boolean): Promise<InstalledPlugin>;
    uninstall(pluginId: string): Promise<void>;
    openCanvas(pluginId: string, contributionId: string, sourceCanvasInstanceId?: string): Promise<void>;
    openWindow(pluginId: string, contributionId: string): Promise<void>;
    openExternal(pluginId: string, url: string): Promise<void>;
    openBrowser(pluginId: string, url: string): Promise<void>;
    storageGet(pluginId: string, key: string): Promise<unknown>;
    storageSet(pluginId: string, key: string, value: unknown): Promise<void>;
    secretsGet(pluginId: string, key: string): Promise<string | null>;
    secretsSet(pluginId: string, key: string, value: string): Promise<void>;
    secretsDelete(pluginId: string, key: string): Promise<void>;
    mediaPickLibrary(pluginId: string): Promise<PluginMediaLibrary | null>;
    mediaListLibraries(pluginId: string): Promise<PluginMediaLibrary[]>;
    mediaScanLibrary(pluginId: string, libraryId: string): Promise<PluginMediaTrack[]>;
    mediaRevokeLibrary(pluginId: string, libraryId: string): Promise<void>;
    playlistsList(pluginId: string, libraryId: string): Promise<PluginPlaylistFile[]>;
    playlistsRead(pluginId: string, libraryId: string, playlistId: string): Promise<string>;
    playlistsWrite(pluginId: string, libraryId: string, name: string, content: string): Promise<PluginPlaylistFile>;
    hermesHudStatus(pluginId: string): Promise<HermesHudSnapshot>;
    hermesHudOpen(pluginId: string): Promise<HermesHudSnapshot>;
    hermesHudClose(pluginId: string): Promise<HermesHudSnapshot>;
    actionsList(pluginId: string): Promise<ProjectActionDefinition[]>;
    actionsRun(pluginId: string, actionId: string, idempotencyKey?: string): Promise<RunProjectActionResult>;
    onOpenLauncher(listener: (event: PluginLauncherRequest) => void): () => void;
    onOpenCanvas(listener: (event: PluginCanvasRequest) => void): () => void;
    onBrowserOpenRequested(listener: (event: PluginBrowserOpenRequest) => void): () => void;
    completeBrowserOpen(response: PluginBrowserOpenResponse): Promise<boolean>;
    onStorageChanged(listener: (event: PluginStorageChangeEvent) => void): () => void;
  };
  browser: {
    getState(): Promise<BrowserSnapshot>;
    open(url?: string): Promise<BrowserSnapshot>;
    close(): Promise<void>;
    closeAllTabs(): Promise<BrowserSnapshot>;
    newTab(url?: string): Promise<BrowserSnapshot>;
    selectTab(id: string): Promise<BrowserSnapshot>;
    closeTab(id: string): Promise<BrowserSnapshot>;
    navigate(id: string, value: string): Promise<BrowserSnapshot>;
    back(id: string): Promise<BrowserSnapshot>;
    forward(id: string): Promise<BrowserSnapshot>;
    reload(id: string): Promise<BrowserSnapshot>;
    execute(command: BrowserCommand): Promise<BrowserResult>;
    getActivity(sinceSequence?: number): Promise<BrowserActivityEvent[]>;
    clearData(): Promise<BrowserSnapshot>;
    focus(): void;
    setInputFocused(focused: boolean): void;
    setViewport(bounds: BrowserViewportBounds): void;
    onState(listener: (event: BrowserStateEvent) => void): () => void;
    onActivity(listener: (event: BrowserActivityStateEvent) => void): () => void;
    onCanvasWheel(listener: (event: BrowserCanvasWheelEvent) => void): () => void;
    onCanvasFreezeFrame(listener: (event: BrowserCanvasFreezeFrameEvent) => void): () => void;
    onCanvasPointer(listener: (event: BrowserCanvasPointerEvent) => void): () => void;
    onCanvasNavigationPointer(listener: (event: BrowserCanvasNavigationPointerEvent) => void): () => void;
  };
  canvasNavigation: {
    armOwnerWheelSequence(clientX: number, clientY: number): void;
    setShortcutCaptureActive(active: boolean): void;
    setPointerGestureActive(active: boolean): void;
    onOverrideState(listener: (event: CanvasNavigationOverrideStateEvent) => void): () => void;
  };
  githubAuth: {
    status(): Promise<GithubAuthStatus>;
    start(): Promise<GithubDeviceFlowStart>;
    signOut(): Promise<void>;
    openUrl(url: string): Promise<void>;
  };
  terminal: {
    list(): Promise<SessionSnapshot[]>;
    create(request: CreateSessionRequest): Promise<SessionSnapshot>;
    restart(id: string): Promise<SessionSnapshot>;
    input(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    setBounds(id: string, bounds: SessionBounds): void;
    rename(id: string, title: string): Promise<SessionMetadata>;
    dispose(id: string): Promise<void>;
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    onSession(listener: (event: SessionEvent) => void): () => void;
    onRemoved(listener: (event: SessionRemovedEvent) => void): () => void;
  };
  window: {
    isMacOS: boolean;
    minimize(): void;
    toggleMaximize(): Promise<WindowState>;
    close(): void;
    getState(): Promise<WindowState>;
    onState(listener: (state: WindowState) => void): () => void;
  };
}

export const IPC = {
  clipboardRead: "clipboard:read",
  clipboardWrite: "clipboard:write",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  workspaceGet: "workspace:get",
  workspaceCatalog: "workspace:catalog",
  workspaceCreate: "workspace:create",
  workspaceSwitch: "workspace:switch",
  workspaceDuplicate: "workspace:duplicate",
  workspaceDelete: "workspace:delete",
  workspaceRename: "workspace:rename",
  workspaceProjectRoot: "workspace:project-root",
  workspaceCamera: "workspace:camera",
  workspaceStartTerminal: "workspace:start-terminal",
  workspaceTerminalBounds: "workspace:terminal-bounds",
  workspaceRemoveTerminal: "workspace:remove-terminal",
  workspacePluginCanvas: "workspace:plugin-canvas",
  workspaceBrowserCanvas: "workspace:browser-canvas",
  workspaceGroupCreate: "workspace:group-create",
  workspaceGroupUpdate: "workspace:group-update",
  workspaceGroupMove: "workspace:group-move",
  workspaceGroupRemove: "workspace:group-remove",
  workspaceAutoArrange: "workspace:auto-arrange",
  workspaceViewSave: "workspace:view-save",
  workspaceViewRemove: "workspace:view-remove",
  workspaceTemplateCreate: "workspace:template-create",
  workspaceTemplateUpdate: "workspace:template-update",
  workspaceTemplateRemove: "workspace:template-remove",
  workspaceTemplateRun: "workspace:template-run",
  workspacePresetSave: "workspace:preset-save",
  workspacePresetRemove: "workspace:preset-remove",
  workspaceExport: "workspace:export",
  workspaceImport: "workspace:import",
  workspaceChanged: "workspace:changed",
  workspaceCatalogChanged: "workspace:catalog-changed",
  actionsList: "actions:list",
  actionsRuns: "actions:runs",
  actionsCreate: "actions:create",
  actionsUpdate: "actions:update",
  actionsRemove: "actions:remove",
  actionsRun: "actions:run",
  actionsApprove: "actions:approve",
  actionsStop: "actions:stop",
  actionsRetry: "actions:retry",
  actionsDiscover: "actions:discover",
  actionsImport: "actions:import",
  actionsRunChanged: "actions:run-changed",
  actionsApprovalRequested: "actions:approval-requested",
  dialogPickDirectory: "dialog:pick-directory",
  dialogPickMedia: "dialog:pick-media",
  mediaRead: "media:read",
  limitsGet: "limits:get",
  pluginsList: "plugins:list",
  pluginsSearch: "plugins:search",
  pluginsShowcase: "plugins:showcase",
  pluginsIcon: "plugins:icon",
  pluginsManifests: "plugins:manifests",
  pluginsCheckUpdates: "plugins:check-updates",
  pluginsUpdate: "plugins:update",
  pluginsUpdatesAvailable: "plugins:updates-available",
  pluginsPreviewInstall: "plugins:preview-install",
  pluginsInstall: "plugins:install",
  pluginsSetModules: "plugins:set-modules",
  pluginsSetEnabled: "plugins:set-enabled",
  pluginsUninstall: "plugins:uninstall",
  pluginsOpenCanvas: "plugins:open-canvas",
  pluginsOpenWindow: "plugins:open-window",
  pluginsOpenExternal: "plugins:open-external",
  pluginsOpenBrowser: "plugins:open-browser",
  pluginsStorageGet: "plugins:storage-get",
  pluginsStorageSet: "plugins:storage-set",
  pluginsSecretsGet: "plugins:secrets-get",
  pluginsSecretsSet: "plugins:secrets-set",
  pluginsSecretsDelete: "plugins:secrets-delete",
  pluginsMediaPickLibrary: "plugins:media-pick-library",
  pluginsMediaListLibraries: "plugins:media-list-libraries",
  pluginsMediaScanLibrary: "plugins:media-scan-library",
  pluginsMediaRevokeLibrary: "plugins:media-revoke-library",
  pluginsPlaylistsList: "plugins:playlists-list",
  pluginsPlaylistsRead: "plugins:playlists-read",
  pluginsPlaylistsWrite: "plugins:playlists-write",
  pluginsHermesHudStatus: "plugins:hermes-hud-status",
  pluginsHermesHudOpen: "plugins:hermes-hud-open",
  pluginsHermesHudClose: "plugins:hermes-hud-close",
  pluginsActionsList: "plugins:actions-list",
  pluginsActionsRun: "plugins:actions-run",
  pluginsHostInvoke: "plugins:host-invoke",
  pluginsLauncherRequested: "plugins:launcher-requested",
  pluginsCanvasRequested: "plugins:canvas-requested",
  pluginsBrowserOpenRequested: "plugins:browser-open-requested",
  pluginsBrowserOpenResponded: "plugins:browser-open-responded",
  pluginsStorageChanged: "plugins:storage-changed",
  browserGetState: "browser:get-state",
  browserOpen: "browser:open",
  browserClose: "browser:close",
  browserCloseAllTabs: "browser:close-all-tabs",
  browserNewTab: "browser:new-tab",
  browserSelectTab: "browser:select-tab",
  browserCloseTab: "browser:close-tab",
  browserNavigate: "browser:navigate",
  browserBack: "browser:back",
  browserForward: "browser:forward",
  browserReload: "browser:reload",
  browserExecute: "browser:execute",
  browserGetActivity: "browser:get-activity",
  browserClearData: "browser:clear-data",
  browserFocus: "browser:focus",
  browserSetInputFocused: "browser:set-input-focused",
  browserSetViewport: "browser:set-viewport",
  browserState: "browser:state",
  browserActivity: "browser:activity",
  browserPageWheelDecision: "browser:page-wheel-decision",
  browserPageWheel: "browser:page-wheel",
  browserCanvasWheel: "browser:canvas-wheel",
  browserCanvasFreezeFrame: "browser:canvas-freeze-frame",
  browserCanvasPointer: "browser:canvas-pointer",
  browserCanvasNavigationPointer: "browser:canvas-navigation-pointer",
  canvasNavigationShortcutCapture: "canvas-navigation:shortcut-capture",
  canvasNavigationOwnerWheel: "canvas-navigation:owner-wheel",
  canvasNavigationPointerGesture: "canvas-navigation:pointer-gesture",
  canvasNavigationOverrideState: "canvas-navigation:override-state",
  appVersion: "app:version",
  githubAuthStatus: "github-auth:status",
  githubAuthStart: "github-auth:start",
  githubAuthSignOut: "github-auth:sign-out",
  githubAuthOpenUrl: "github-auth:open-url",
  terminalList: "terminal:list",
  terminalCreate: "terminal:create",
  terminalRestart: "terminal:restart",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalBounds: "terminal:bounds",
  terminalRename: "terminal:rename",
  terminalDispose: "terminal:dispose",
  terminalData: "terminal:data",
  terminalSession: "terminal:session",
  terminalRemoved: "terminal:removed",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  windowGetState: "window:get-state",
  windowState: "window:state"
} as const;
