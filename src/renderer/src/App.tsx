import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentProviderId,
  ActionApprovalRequest,
  ActionDiscoveryResult,
  ActionRunSnapshot,
  AppSettings,
  BrowserCanvasState,
  BrowserSnapshot,
  CameraState,
  GithubPluginSearchResult,
  HomeAccentColors,
  HomeGridSize,
  HomeWidgetPlacement,
  InstalledPlugin,
  LaunchProfileId,
  LimitsSnapshot,
  Point,
  PluginContribution,
  PluginGridSize,
  PluginInstallPreview,
  PluginManifest,
  PluginUpdateStatus,
  ProjectActionDefinition,
  ProjectActionInput,
  ProviderId,
  SessionBounds,
  SessionSnapshot,
  WorkspaceDocument,
  WorkspaceCatalogSnapshot,
  WorkspaceArrangeMode,
  WorkspaceGroupInput,
  WorkspaceGroupUpdate,
  WorkspacePresetInput,
  WorkspaceSavedViewInput,
  TerminalTemplateInput,
  WindowState
} from "../../shared/contracts";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_HOME_ACCENT_COLORS,
  DEFAULT_HOME_GRID_SIZE,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_SHORTCUTS,
  WORKSPACE_SCHEMA_VERSION
} from "../../shared/contracts";
import { TitleBar } from "./components/TitleBar";
import { Toast } from "./components/Toast";
import { AgentLaunchDialog } from "./features/launcher/AgentLaunchDialog";
import { ActionsPanel } from "./features/actions/ActionsPanel";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { resolveAppearanceSettings } from "./features/settings/appearanceSettings";
import { persistSettingsUpdate } from "./features/settings/persistSettings";
import { PluginBrowserOpenQueue } from "./features/plugins/PluginBrowserOpenQueue";
import { WorkspaceCanvas } from "./features/workspace/WorkspaceCanvas";
import { WorkspacePanel } from "./features/workspaces/WorkspacePanel";
import { CommandPalette, type PaletteCommand } from "./features/workspaces/CommandPalette";
import type { LimitsLoadState } from "./features/home/homeModel";
import { t } from "./lib/i18n";
import {
  mergeSessionSnapshots,
  upsertSession,
  upsertSnapshot
} from "./lib/sessionReconciliation";
import { isRenameInputTarget, isShortcutCaptureTarget, matchesShortcut } from "./lib/shortcuts";
import { homeGridPixelSize, homeLayoutFitsGrid, placeHomeWidget } from "./features/home/homeLayout";

interface HomeEditDraft {
  homeGridSize: HomeGridSize;
  homeLayout: HomeWidgetPlacement[];
}

const FALLBACK_SETTINGS: AppSettings = {
  locale: "ru",
  palette: "sage",
  homeAccentPreset: "classic",
  homeAccentColors: { ...DEFAULT_HOME_ACCENT_COLORS },
  homeLauncherProviders: ["codex", "claude", "qwen", "kimi", "opencode", "hermes", "grok"],
  homeLimitProviders: ["codex", "claude", "qwen", "kimi", "opencode", "grok"],
  canvasColor: "sage",
  pattern: "dots",
  snapToGrid: true,
  invertTerminalWheel: true,
  invertCanvasWheel: false,
  edgePan: false,
  edgePanSpeed: "normal",
  zoomSensitivity: "normal",
  useScrollWheelToZoom: false,
  canvasWheelCaptureMode: "key",
  canvasWheelOverride: window.canvasTTY.window.isMacOS ? "Meta" : "Ctrl",
  canvasNavigationOverride: "Alt",
  focusActivation: "off",
  hoverFocus: false,
  hoverFocusSpeed: "normal",
  showShortcutHints: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  mediaPath: null,
  mediaFit: "cover",
  lastDirectory: "/",
  acknowledgedDangerousProfiles: [],
  homeGridSize: { ...DEFAULT_HOME_GRID_SIZE },
  homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
  pluginCanvas: [],
  browserCanvas: null,
  browserAgentAccess: true,
  browserShowAgentPresence: true,
  browserRestoreTabs: true
};

const EMPTY_BROWSER_SNAPSHOT: BrowserSnapshot = {
  tabs: [],
  activeTabId: null,
  visible: false,
  agents: [],
  downloads: [],
  pendingDialog: null
};

const FALLBACK_WORKSPACE: WorkspaceDocument = {
  schemaVersion: WORKSPACE_SCHEMA_VERSION,
  id: DEFAULT_WORKSPACE_ID,
  revision: 0,
  title: "Workspace",
  projectRoot: "",
  camera: { x: 0, y: 0, zoom: 1 },
  terminals: [],
  groups: [],
  savedViews: [],
  templates: [],
  actions: [],
  actionRuns: [],
  pluginCanvas: [],
  browserCanvas: null,
  updatedAt: 0
};

const FALLBACK_CATALOG: WorkspaceCatalogSnapshot = {
  revision: 0,
  activeId: DEFAULT_WORKSPACE_ID,
  workspaces: [{ id: DEFAULT_WORKSPACE_ID, title: "Workspace", projectRoot: "", objectCount: 0, updatedAt: 0 }],
  presets: []
};

const DEFAULT_FOCUS_ZOOM = 0.92;
const PLUGIN_CANVAS_FOCUS_ZOOM = 1;

function customHomeAccentStyle(colors: HomeAccentColors): React.CSSProperties {
  const launcherTile = mixHexWithWhite(colors.launcher, 0.62);
  return {
    "--home-clock": colors.clock,
    "--home-clock-text": readableTextColor(colors.clock),
    "--home-launcher-dock": colors.launcher,
    "--home-launcher-tile": launcherTile,
    "--home-launcher-text": readableTextColor(launcherTile),
    "--home-browser": colors.browser,
    "--home-browser-text": readableTextColor(colors.browser),
    "--home-settings": colors.settings,
    "--home-settings-text": readableTextColor(colors.settings),
    "--home-media": colors.media,
    "--home-media-text": readableTextColor(colors.media)
  } as React.CSSProperties;
}

function mixHexWithWhite(hex: string, sourceWeight: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `#${channels.map((channel) => (
    Math.round(channel * sourceWeight + 255 * (1 - sourceWeight)).toString(16).padStart(2, "0")
  )).join("")}`.toUpperCase();
}

function readableTextColor(hex: string): "#30313D" | "#FFFFFF" {
  const background = relativeLuminance(hex);
  const darkContrast = contrastRatio(background, relativeLuminance("#30313D"));
  const lightContrast = contrastRatio(background, 1);
  return darkContrast >= lightContrast ? "#30313D" : "#FFFFFF";
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(left: number, right: number): number {
  const brightest = Math.max(left, right);
  const darkest = Math.min(left, right);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState(FALLBACK_SETTINGS);
  const [workspace, setWorkspace] = useState(FALLBACK_WORKSPACE);
  const [workspaceCatalog, setWorkspaceCatalog] = useState(FALLBACK_CATALOG);
  const [actionRuns, setActionRuns] = useState<ActionRunSnapshot[]>([]);
  const [actionApprovals, setActionApprovals] = useState<ActionApprovalRequest[]>([]);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [limits, setLimits] = useState<LimitsSnapshot | null>(null);
  const [limitsLoadState, setLimitsLoadState] = useState<LimitsLoadState>("loading");
  const [mediaData, setMediaData] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [browser, setBrowser] = useState<BrowserSnapshot>(EMPTY_BROWSER_SNAPSHOT);
  const [camera, setCamera] = useState<CameraState>(() => homeCamera(DEFAULT_HOME_GRID_SIZE));
  const isHomeCamera = useRef(true);
  const browserCanvasRef = useRef<BrowserCanvasState | null>(null);
  const pluginBrowserOpenQueueRef = useRef(new PluginBrowserOpenQueue());
  const [launchProvider, setLaunchProvider] = useState<AgentProviderId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [homeEditDraft, setHomeEditDraft] = useState<HomeEditDraft | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [browserSelected, setBrowserSelected] = useState(false);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [windowState, setWindowState] = useState<WindowState>({
    isMacOS: window.canvasTTY.window.isMacOS,
    maximized: false,
    fullscreen: false
  });

  const showToast = useCallback((message: string): void => setToast(message), []);

  useEffect(() => {
    browserCanvasRef.current = workspace.browserCanvas;
  }, [workspace.browserCanvas]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const unsubscribe = window.canvasTTY.window.onState(setWindowState);
    void window.canvasTTY.window.getState().then(setWindowState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    const browserApi = window.canvasTTY.browser;
    const acceptWorkspace = (candidate: WorkspaceDocument): void => {
      if (!active) return;
      setWorkspace((current) => candidate.id !== current.id || candidate.revision >= current.revision ? candidate : current);
    };
    const unsubscribeSession = window.canvasTTY.terminal.onSession(({ session }) => {
      if (active) setSessions((current) => upsertSession(current, session));
    });
    const unsubscribeRemoved = window.canvasTTY.terminal.onRemoved(({ id }) => {
      if (!active) return;
      setSessions((current) => current.filter((session) => session.id !== id));
      setActiveSessionId((current) => current === id ? null : current);
      setRenamingSessionId((current) => current === id ? null : current);
    });
    const unsubscribeWorkspace = window.canvasTTY.workspace.onChanged(({ workspace: updated }) => {
      acceptWorkspace(updated);
    });
    const unsubscribeCatalog = window.canvasTTY.workspace.onCatalogChanged(({ catalog }) => {
      if (active) setWorkspaceCatalog(catalog);
    });
    const unsubscribeRun = window.canvasTTY.actions.onRun(({ run }) => {
      if (!active) return;
      setActionRuns((current) => current.some((candidate) => candidate.id === run.id)
        ? current.map((candidate) => candidate.id === run.id ? run : candidate)
        : [...current, run]);
    });
    const unsubscribeApproval = window.canvasTTY.actions.onApproval(({ approval }) => {
      if (!active) return;
      setActionApprovals((current) => [...current.filter((candidate) => candidate.token !== approval.token), approval]);
      showToast(settings.locale === "ru" ? "Агент запрашивает подтверждение Project Action" : "An agent requests Project Action approval");
    });

    const settingsRequest = window.canvasTTY.settings.get();
    const workspaceRequest = window.canvasTTY.workspace.get();
    const catalogRequest = window.canvasTTY.workspace.catalog();
    const runsRequest = window.canvasTTY.actions.runs();
    const sessionsRequest = window.canvasTTY.terminal.list().then((loadedSessions) => {
      if (active) setSessions((current) => mergeSessionSnapshots(current, loadedSessions));
      return loadedSessions;
    });
    const pluginsRequest = window.canvasTTY.plugins.list();

    void Promise.all([settingsRequest, workspaceRequest, catalogRequest, runsRequest, sessionsRequest, pluginsRequest])
      .then(async ([loadedSettings, loadedWorkspace, loadedCatalog, loadedRuns, _loadedSessions, loadedPlugins]) => {
        if (!active) return;
        setSettings(loadedSettings);
        acceptWorkspace(loadedWorkspace);
        setWorkspaceCatalog(loadedCatalog);
        setActionRuns(loadedRuns);
        setPlugins(loadedPlugins);
        if (loadedWorkspace.browserCanvas && browserApi) {
          const browserState = await browserApi.open();
          if (active) setBrowser(browserState);
        }
        setCamera(loadedWorkspace.camera);
        isHomeCamera.current = false;
        if (loadedSettings.mediaPath) {
          const data = await window.canvasTTY.media.read(loadedSettings.mediaPath);
          if (active) setMediaData(data);
        }
      })
      .catch((error) => showToast(error instanceof Error ? error.message : "CanvasTTY initialization failed"))
      .finally(() => active && setReady(true));

    return () => {
      active = false;
      unsubscribeSession();
      unsubscribeRemoved();
      unsubscribeWorkspace();
      unsubscribeCatalog();
      unsubscribeRun();
      unsubscribeApproval();
    };
  }, [showToast]);

  useEffect(() => {
    const browserApi = window.canvasTTY.browser;
    if (!browserApi) return;
    const unsubscribe = browserApi.onState(({ snapshot }) => setBrowser(snapshot));
    void browserApi.getState().then(setBrowser).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    let requestRunning = false;
    let timer: number | null = null;

    const refreshLimits = async (): Promise<void> => {
      if (requestRunning) return;
      requestRunning = true;
      try {
        const snapshot = await window.canvasTTY.limits.get();
        if (!active) return;
        setLimits(snapshot);
        setLimitsLoadState("ready");
      } catch {
        if (active) setLimitsLoadState("error");
      } finally {
        requestRunning = false;
      }
    };

    const refreshAndSchedule = async (): Promise<void> => {
      await refreshLimits();
      if (active) timer = window.setTimeout(() => void refreshAndSchedule(), 60_000);
    };

    void refreshAndSchedule();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const recenterHome = (): void => {
      if (isHomeCamera.current) setCamera(homeCamera(settings.homeGridSize));
    };
    window.addEventListener("resize", recenterHome);
    return () => window.removeEventListener("resize", recenterHome);
  }, [settings.homeGridSize]);

  useEffect(() => {
    if (!ready || homeEditDraft) return;
    const timer = window.setTimeout(() => {
      void window.canvasTTY.workspace.setCamera(camera).catch(() => undefined);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [camera, homeEditDraft, ready, workspace.id]);

  const persistSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    await persistSettingsUpdate(
      (nextPatch) => window.canvasTTY.settings.update(nextPatch),
      (updated) => setSettings(updated),
      patch
    );
  }, []);

  const saveSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    try {
      await persistSettings(patch);
    } catch {
      showToast(t(settings.locale, "settingsFailed"));
    }
  }, [persistSettings, settings.locale, showToast]);

  const createSession = useCallback(async (
    provider: ProviderId,
    profile: LaunchProfileId,
    cwd: string
  ): Promise<SessionSnapshot> => {
    const position = nextSessionPosition(sessions.length, settings.homeGridSize);
    const session = await window.canvasTTY.terminal.create({ provider, profile, cwd, position });
    setSessions((current) => upsertSnapshot(current, session));
    setActiveSessionId(session.id);
    await saveSettings({ lastDirectory: cwd });
    isHomeCamera.current = false;
    setCamera(focusCamera(position, session.size));
    return session;
  }, [sessions.length, saveSettings, settings.homeGridSize]);

  const openTerminal = useCallback(async (): Promise<void> => {
    try {
      await createSession("terminal", "normal", settings.lastDirectory);
      showToast(t(settings.locale, "terminalStarted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "launchFailed"));
    }
  }, [createSession, settings.lastDirectory, settings.locale, showToast]);

  useEffect(() => window.canvasTTY.plugins.onOpenLauncher(({ provider }) => {
    if (provider === "terminal") void openTerminal();
    else setLaunchProvider(provider);
  }), [openTerminal]);


  const launchAgent = useCallback(async (
    provider: AgentProviderId,
    profile: LaunchProfileId,
    cwd: string
  ): Promise<void> => {
    await createSession(provider, profile, cwd);
    showToast(`${t(settings.locale, "sessionStarted")}: ${provider}`);
  }, [createSession, settings.locale, showToast]);

  const restartSession = useCallback(async (id: string): Promise<void> => {
    try {
      await window.canvasTTY.terminal.restart(id);
      showToast(t(settings.locale, "sessionRestarted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "restartFailed"));
    }
  }, [settings.locale, showToast]);

  const startWorkspaceTerminal = useCallback(async (id: string): Promise<void> => {
    try {
      const session = await window.canvasTTY.workspace.startTerminal(id);
      setSessions((current) => upsertSnapshot(current, session));
      setBrowserSelected(false);
      setActiveSessionId(session.id);
      isHomeCamera.current = false;
      setCamera(focusCamera(session.position, session.size));
      showToast(t(settings.locale, "terminalStarted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "launchFailed"));
      throw error;
    }
  }, [settings.locale, showToast]);

  const changeWorkspaceTerminalBounds = useCallback(async (
    id: string,
    bounds: SessionBounds
  ): Promise<void> => {
    try {
      const updated = await window.canvasTTY.workspace.setTerminalBounds({ id, bounds });
      setWorkspace((current) => updated.revision >= current.revision ? updated : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "settingsFailed"));
      throw error;
    }
  }, [settings.locale, showToast]);

  const removeWorkspaceTerminal = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await window.canvasTTY.workspace.removeTerminal(id);
      setWorkspace((current) => updated.revision >= current.revision ? updated : current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "settingsFailed"));
      throw error;
    }
  }, [settings.locale, showToast]);

  const renameWorkspace = useCallback(async (title: string): Promise<void> => {
    const updated = await window.canvasTTY.workspace.rename(title);
    setWorkspace((current) => updated.revision >= current.revision ? updated : current);
  }, []);

  const acceptWorkspaceSwitch = useCallback((result: { catalog: WorkspaceCatalogSnapshot; workspace: WorkspaceDocument }): void => {
    setWorkspaceCatalog(result.catalog);
    setWorkspace(result.workspace);
    setActionRuns(result.workspace.actionRuns);
    setCamera(result.workspace.camera);
    browserCanvasRef.current = result.workspace.browserCanvas;
    isHomeCamera.current = false;
    setActiveSessionId(null);
    setBrowserSelected(false);
    setRenamingSessionId(null);
  }, []);

  const switchWorkspace = useCallback(async (id: string): Promise<void> => {
    await window.canvasTTY.workspace.setCamera(camera);
    acceptWorkspaceSwitch(await window.canvasTTY.workspace.switch(id));
  }, [acceptWorkspaceSwitch, camera]);

  const createWorkspace = useCallback(async (title: string, projectRoot: string, presetId?: string): Promise<void> => {
    acceptWorkspaceSwitch(await window.canvasTTY.workspace.create({ title, projectRoot, presetId }));
  }, [acceptWorkspaceSwitch]);

  const duplicateWorkspace = useCallback(async (id: string): Promise<void> => {
    acceptWorkspaceSwitch(await window.canvasTTY.workspace.duplicate(id));
  }, [acceptWorkspaceSwitch]);

  const deleteWorkspace = useCallback(async (id: string): Promise<void> => {
    acceptWorkspaceSwitch(await window.canvasTTY.workspace.delete(id));
  }, [acceptWorkspaceSwitch]);

  const setProjectRoot = useCallback(async (projectRoot: string): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.setProjectRoot(projectRoot));
  }, []);

  const createWorkspaceGroup = useCallback(async (input: WorkspaceGroupInput): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.createGroup(input));
  }, []);

  const updateWorkspaceGroup = useCallback(async (input: WorkspaceGroupUpdate): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.updateGroup(input));
  }, []);

  const moveWorkspaceGroup = useCallback(async (id: string, position: Point): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.moveGroup(id, position));
  }, []);

  const removeWorkspaceGroup = useCallback(async (id: string, removeMembers = false): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.removeGroup(id, removeMembers));
  }, []);

  const autoArrangeWorkspace = useCallback(async (mode: WorkspaceArrangeMode, objectIds?: string[]): Promise<void> => {
    const updated = await window.canvasTTY.workspace.autoArrange(mode, objectIds);
    setWorkspace(updated);
  }, []);

  const saveWorkspaceView = useCallback(async (input: WorkspaceSavedViewInput): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.saveView(input));
  }, []);

  const removeWorkspaceView = useCallback(async (id: string): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.removeView(id));
  }, []);

  const createTerminalTemplate = useCallback(async (input: TerminalTemplateInput): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.createTemplate(input));
  }, []);

  const removeTerminalTemplate = useCallback(async (id: string): Promise<void> => {
    setWorkspace(await window.canvasTTY.workspace.removeTemplate(id));
  }, []);

  const runTerminalTemplate = useCallback(async (id: string): Promise<void> => {
    const session = await window.canvasTTY.workspace.runTemplate(id, nextSessionPosition(sessions.length, settings.homeGridSize));
    setSessions((current) => upsertSnapshot(current, session));
    setActiveSessionId(session.id);
    setWorkspacePanelOpen(false);
    setCamera(focusCamera(session.position, session.size));
  }, [sessions.length, settings.homeGridSize]);

  const saveWorkspacePreset = useCallback(async (input: WorkspacePresetInput): Promise<void> => {
    setWorkspaceCatalog(await window.canvasTTY.workspace.savePreset(input));
  }, []);

  const removeWorkspacePreset = useCallback(async (id: string): Promise<void> => {
    setWorkspaceCatalog(await window.canvasTTY.workspace.removePreset(id));
  }, []);

  const exportWorkspace = useCallback((): Promise<string> => window.canvasTTY.workspace.export(), []);
  const importWorkspace = useCallback(async (raw: string): Promise<void> => {
    acceptWorkspaceSwitch(await window.canvasTTY.workspace.import(raw));
  }, [acceptWorkspaceSwitch]);

  const createProjectAction = useCallback(async (input: ProjectActionInput): Promise<void> => {
    const updated = await window.canvasTTY.actions.create(input);
    setWorkspace((current) => updated.revision >= current.revision ? updated : current);
    showToast(t(settings.locale, "saveAction"));
  }, [settings.locale, showToast]);

  const updateProjectAction = useCallback(async (id: string, input: ProjectActionInput): Promise<void> => {
    const updated = await window.canvasTTY.actions.update({ id, ...input });
    setWorkspace((current) => updated.revision >= current.revision ? updated : current);
    showToast(t(settings.locale, "saveAction"));
  }, [settings.locale, showToast]);

  const removeProjectAction = useCallback(async (id: string): Promise<void> => {
    const updated = await window.canvasTTY.actions.remove(id);
    setWorkspace((current) => updated.revision >= current.revision ? updated : current);
  }, []);

  const discoverProjectActions = useCallback(async (): Promise<ActionDiscoveryResult> => {
    const root = workspace.projectRoot || settings.lastDirectory;
    return window.canvasTTY.actions.discover(root);
  }, [settings.lastDirectory, workspace.projectRoot]);

  const importProjectActions = useCallback(async (inputs: ProjectActionInput[]): Promise<void> => {
    setWorkspace(await window.canvasTTY.actions.import(inputs));
  }, []);

  const runProjectAction = useCallback(async (action: ProjectActionDefinition): Promise<void> => {
    const position = nextSessionPosition(sessions.length, settings.homeGridSize);
    let result = await window.canvasTTY.actions.run({ id: action.id, position, requester: "user" });
    if (result.needsApproval && result.approvalToken) result = await window.canvasTTY.actions.approve(result.approvalToken);
    setActionRuns((current) => current.some((run) => run.id === result.run.id)
      ? current.map((run) => run.id === result.run.id ? result.run : run)
      : [...current, result.run]);
    if (result.session) setSessions((current) => upsertSnapshot(current, result.session!));
    setSettingsOpen(false);
    setBrowserSelected(false);
    if (result.session) {
      setActiveSessionId(result.session.id);
      isHomeCamera.current = false;
      setCamera(focusCamera(result.session.position, result.session.size));
    }
    showToast(t(settings.locale, result.focusedExisting ? "actionAlreadyRunning" : "actionStarted"));
  }, [sessions.length, settings.homeGridSize, settings.locale, showToast]);

  const stopProjectAction = useCallback(async (runId: string): Promise<void> => {
    const run = await window.canvasTTY.actions.stop(runId);
    setActionRuns((current) => current.map((candidate) => candidate.id === run.id ? run : candidate));
    showToast(t(settings.locale, "actionStopped"));
  }, [settings.locale, showToast]);

  const retryProjectAction = useCallback(async (runId: string, stepId?: string): Promise<void> => {
    let result = await window.canvasTTY.actions.retry(runId, stepId);
    if (result.needsApproval && result.approvalToken) result = await window.canvasTTY.actions.approve(result.approvalToken);
    setActionRuns((current) => current.some((run) => run.id === result.run.id)
      ? current.map((run) => run.id === result.run.id ? result.run : run)
      : [...current, result.run]);
    if (result.session) setSessions((current) => upsertSnapshot(current, result.session!));
  }, []);

  const approveProjectAction = useCallback(async (token: string): Promise<void> => {
    const result = await window.canvasTTY.actions.approve(token);
    setActionApprovals((current) => current.filter((approval) => approval.token !== token));
    setActionRuns((current) => current.some((run) => run.id === result.run.id)
      ? current.map((run) => run.id === result.run.id ? result.run : run)
      : [...current, result.run]);
    if (result.session) setSessions((current) => upsertSnapshot(current, result.session!));
  }, []);

  const acknowledgeDanger = useCallback(async (provider: AgentProviderId): Promise<void> => {
    if (settings.acknowledgedDangerousProfiles.includes(provider)) return;
    await saveSettings({
      acknowledgedDangerousProfiles: [...settings.acknowledgedDangerousProfiles, provider]
    });
  }, [saveSettings, settings.acknowledgedDangerousProfiles]);

  const requestMedia = useCallback(async (): Promise<void> => {
    try {
      const selection = await window.canvasTTY.dialog.pickMedia();
      if (!selection) return;

      const updated = await window.canvasTTY.settings.update({ mediaPath: selection.path });
      setSettings(updated);
      setMediaData(selection.dataUrl);
    } catch {
      showToast(t(settings.locale, "mediaFailed"));
    }
  }, [settings.locale, showToast]);

  const removeMedia = useCallback(async (): Promise<void> => {
    try {
      const updated = await window.canvasTTY.settings.update({ mediaPath: null });
      setSettings(updated);
      setMediaData(null);
    } catch {
      showToast(t(settings.locale, "mediaFailed"));
    }
  }, [settings.locale, showToast]);

  const changeSessionBounds = useCallback((id: string, bounds: SessionBounds): void => {
    setSessions((current) => current.map((session) => session.id === id
      ? { ...session, position: bounds.position, size: bounds.size }
      : session));
    window.canvasTTY.terminal.setBounds(id, bounds);
  }, []);

  const changePluginCanvasBounds = useCallback((id: string, bounds: SessionBounds): void => {
    const pluginCanvas = workspace.pluginCanvas.map((instance) => instance.id === id
      ? { ...instance, position: bounds.position, size: bounds.size }
      : instance);
    setWorkspace((current) => ({ ...current, pluginCanvas }));
    void window.canvasTTY.workspace.setPluginCanvas(pluginCanvas).catch((error) => showToast(error instanceof Error ? error.message : "Workspace update failed"));
  }, [showToast, workspace.pluginCanvas]);

  const changeBrowserBounds = useCallback((browserCanvas: BrowserCanvasState): void => {
    browserCanvasRef.current = browserCanvas;
    setWorkspace((current) => ({ ...current, browserCanvas }));
    void window.canvasTTY.workspace.setBrowserCanvas(browserCanvas).catch((error) => showToast(error instanceof Error ? error.message : "Workspace update failed"));
  }, [showToast]);

  const disposePluginCanvas = useCallback((id: string): void => {
    void window.canvasTTY.workspace.setPluginCanvas(workspace.pluginCanvas.filter((instance) => instance.id !== id));
  }, [workspace.pluginCanvas]);

  const focusPluginCanvas = useCallback((id: string): void => {
    const instance = workspace.pluginCanvas.find((candidate) => candidate.id === id);
    if (!instance) return;
    setActiveSessionId(null);
    setBrowserSelected(false);
    isHomeCamera.current = false;
    setCamera(focusCamera(instance.position, instance.size, PLUGIN_CANVAS_FOCUS_ZOOM));
  }, [workspace.pluginCanvas]);

  const openBrowser = useCallback(async (url?: string): Promise<void> => {
    const browserApi = window.canvasTTY.browser;
    if (!browserApi) throw new Error(t(settings.locale, "browserRestartRequired"));
    const existingBrowserCanvas = browserCanvasRef.current;
    const homeSize = homeGridPixelSize(settings.homeGridSize);
    const browserCanvas = existingBrowserCanvas ?? {
      position: {
        x: homeSize.width + 160 + ((sessions.length + workspace.pluginCanvas.length) % 2) * 760,
        y: Math.floor((sessions.length + workspace.pluginCanvas.length) / 2) * 500 + 20
      },
      size: { width: 920, height: 620 }
    };
    const snapshot = await browserApi.open(url);
    setBrowser(snapshot);
    if (!existingBrowserCanvas) {
      browserCanvasRef.current = browserCanvas;
      try {
        await window.canvasTTY.workspace.setBrowserCanvas(browserCanvas);
      } catch (error) {
        browserCanvasRef.current = existingBrowserCanvas;
        throw error;
      }
    }
    setSettingsOpen(false);
    setActiveSessionId(null);
    setBrowserSelected(true);
    isHomeCamera.current = false;
    setCamera(focusCamera(browserCanvas.position, browserCanvas.size));
  }, [sessions.length, settings.homeGridSize, settings.locale, workspace.pluginCanvas.length]);

  useEffect(() => {
    return window.canvasTTY.plugins.onBrowserOpenRequested((request) => {
      void pluginBrowserOpenQueueRef.current.enqueue(() => openBrowser(request.url)).then(
        () => window.canvasTTY.plugins.completeBrowserOpen({ requestId: request.requestId, ok: true }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : t(settings.locale, "browserActionFailed");
          showToast(message);
          return window.canvasTTY.plugins.completeBrowserOpen({ requestId: request.requestId, ok: false, error: message });
        }
      ).catch(() => undefined);
    });
  }, [openBrowser, settings.locale, showToast]);

  const openBrowserFromUi = useCallback((): void => {
    void openBrowser().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : t(settings.locale, "browserActionFailed"));
    });
  }, [openBrowser, settings.locale, showToast]);

  const closeBrowser = useCallback(async (): Promise<void> => {
    try {
      const browserApi = window.canvasTTY.browser;
      if (!browserApi) return;
      await browserApi.close();
      browserCanvasRef.current = null;
      await window.canvasTTY.workspace.setBrowserCanvas(null);
      setBrowserSelected(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t(settings.locale, "browserActionFailed"));
    }
  }, [settings.locale, showToast]);

  const focusBrowser = useCallback((): void => {
    if (!workspace.browserCanvas) return;
    setActiveSessionId(null);
    setBrowserSelected(true);
    isHomeCamera.current = false;
    setCamera(focusCamera(workspace.browserCanvas.position, workspace.browserCanvas.size));
  }, [workspace.browserCanvas]);

  const disposeSession = useCallback((id: string): void => {
    void window.canvasTTY.terminal.dispose(id);
    setSessions((current) => current.filter((session) => session.id !== id));
    setActiveSessionId((current) => current === id ? null : current);
    setRenamingSessionId((current) => current === id ? null : current);
  }, []);

  const focusSession = useCallback((session: SessionSnapshot): void => {
    setBrowserSelected(false);
    setActiveSessionId(session.id);
    isHomeCamera.current = false;
    setCamera(focusCamera(session.position, session.size));
  }, []);

  const renameSession = useCallback(async (id: string, title: string): Promise<void> => {
    try {
      const metadata = await window.canvasTTY.terminal.rename(id, title);
      setSessions((current) => upsertSession(current, metadata));
    } catch {
      showToast(t(settings.locale, "renameFailed"));
    }
  }, [settings.locale, showToast]);

  const changeCamera = useCallback((nextCamera: CameraState): void => {
    isHomeCamera.current = false;
    setCamera(nextCamera);
  }, []);

  const goHome = useCallback((): void => {
    isHomeCamera.current = true;
    setCamera(homeCamera(homeEditDraft?.homeGridSize ?? settings.homeGridSize));
  }, [homeEditDraft?.homeGridSize, settings.homeGridSize]);

  const changeHomeLayout = useCallback((homeLayout: HomeWidgetPlacement[]): void => {
    setHomeEditDraft((current) => current ? { ...current, homeLayout } : current);
  }, []);

  const changeHomeGridSize = useCallback((homeGridSize: HomeGridSize): void => {
    setHomeEditDraft((current) => current ? { ...current, homeGridSize } : current);
    isHomeCamera.current = true;
    setCamera(homeCamera(homeGridSize));
  }, []);

  const resetHomeLayout = useCallback((): void => {
    const homeGridSize = { ...DEFAULT_HOME_GRID_SIZE };
    setHomeEditDraft((current) => current ? {
      homeGridSize,
      homeLayout: structuredClone(DEFAULT_HOME_LAYOUT)
    } : current);
    isHomeCamera.current = true;
    setCamera(homeCamera(homeGridSize));
  }, []);

  const toggleHomeWidget = useCallback(async (
    widgetId: string,
    defaultSize: PluginGridSize
  ): Promise<void> => {
    const exists = settings.homeLayout.some((placement) => placement.widgetId === widgetId);
    if (exists) {
      if (widgetId === "core.settings") return;
      await saveSettings({
        homeLayout: settings.homeLayout.filter((placement) => placement.widgetId !== widgetId)
      });
      return;
    }

    const result = placeHomeWidget(
      settings.homeLayout,
      widgetId,
      defaultSize,
      settings.homeGridSize
    );
    if (!result) {
      showToast(t(settings.locale, "homeLayoutFull"));
      return;
    }
    await saveSettings({
      homeGridSize: result.gridSize,
      homeLayout: [...settings.homeLayout, result.placement]
    });
  }, [saveSettings, settings.homeGridSize, settings.homeLayout, settings.locale, showToast]);

  const previewPlugin = useCallback((sourceUrl: string): Promise<PluginInstallPreview> => (
    window.canvasTTY.plugins.previewInstall(sourceUrl)
  ), []);

  const installPlugin = useCallback(async (token: string, selectedModules: string[]): Promise<void> => {
    const installed = await window.canvasTTY.plugins.install(token, selectedModules);
    setPlugins((current) => [...current.filter((plugin) => plugin.manifest.id !== installed.manifest.id), installed]);

    let homeLayout = settings.homeLayout;
    let homeGridSize = settings.homeGridSize;
    for (const contribution of installed.manifest.contributions) {
      if (contribution.kind !== "home-widget") continue;
      const widgetId = `plugin:${installed.manifest.id}:${contribution.id}`;
      const result = placeHomeWidget(homeLayout, widgetId, contribution.defaultSize, homeGridSize);
      if (!result) continue;
      homeGridSize = result.gridSize;
      homeLayout = [...homeLayout, result.placement];
    }
    if (homeLayout !== settings.homeLayout) await saveSettings({ homeGridSize, homeLayout });
    showToast(`${t(settings.locale, "pluginInstalled")}: ${installed.manifest.name}`);
  }, [saveSettings, settings.homeGridSize, settings.homeLayout, settings.locale, showToast]);

  const setPluginEnabled = useCallback(async (pluginId: string, enabled: boolean): Promise<void> => {
    const updated = await window.canvasTTY.plugins.setEnabled(pluginId, enabled);
    setPlugins((current) => current.map((plugin) => plugin.manifest.id === pluginId ? updated : plugin));
  }, []);

  const setPluginModules = useCallback(async (pluginId: string, selectedModules: string[]): Promise<void> => {
    const updated = await window.canvasTTY.plugins.setModules(pluginId, selectedModules);
    setPlugins((current) => current.map((plugin) => plugin.manifest.id === pluginId ? updated : plugin));
    const contributions = new Set(updated.manifest.contributions.map((contribution) => contribution.id));
    await saveSettings({
      homeLayout: settings.homeLayout.filter((placement) => {
        const prefix = `plugin:${pluginId}:`;
        return !placement.widgetId.startsWith(prefix) || contributions.has(placement.widgetId.slice(prefix.length));
      })
    });
    await window.canvasTTY.workspace.setPluginCanvas(workspace.pluginCanvas.filter((instance) => (
      instance.pluginId !== pluginId || contributions.has(instance.contributionId)
    )));
  }, [saveSettings, settings.homeLayout, workspace.pluginCanvas]);

  const uninstallPlugin = useCallback(async (pluginId: string): Promise<void> => {
    await window.canvasTTY.plugins.uninstall(pluginId);
    setPlugins((current) => current.filter((plugin) => plugin.manifest.id !== pluginId));
    await saveSettings({
      homeLayout: settings.homeLayout.filter((placement) => !placement.widgetId.startsWith(`plugin:${pluginId}:`))
    });
    await window.canvasTTY.workspace.setPluginCanvas(workspace.pluginCanvas.filter((instance) => instance.pluginId !== pluginId));
    showToast(t(settings.locale, "pluginRemoved"));
  }, [saveSettings, settings.homeLayout, settings.locale, showToast, workspace.pluginCanvas]);

  const searchPlugins = useCallback((query: string): Promise<GithubPluginSearchResult[]> => (
    window.canvasTTY.plugins.search(query)
  ), []);

  const showcasePlugins = useCallback((): Promise<GithubPluginSearchResult[]> => (
    window.canvasTTY.plugins.showcase()
  ), []);

  const fetchPluginIcons = useCallback((sourceUrls: string[]): Promise<Record<string, string | null>> => (
    window.canvasTTY.plugins.icon(sourceUrls)
  ), []);

  const previewManifests = useCallback((sourceUrls: string[]): Promise<Record<string, PluginManifest>> => (
    window.canvasTTY.plugins.manifests(sourceUrls)
  ), []);

  const checkPluginUpdates = useCallback((): Promise<PluginUpdateStatus[]> => (
    window.canvasTTY.plugins.checkUpdates()
  ), []);

  const updatePlugin = useCallback(async (pluginId: string): Promise<void> => {
    const updated = await window.canvasTTY.plugins.update(pluginId);
    setPlugins((current) => current.map((plugin) => plugin.manifest.id === pluginId ? updated : plugin));
    showToast(`${t(settings.locale, "pluginUpdated")}: ${updated.manifest.name}`);
  }, [settings.locale, showToast]);

  const openPluginCanvasContribution = useCallback(async (
    plugin: InstalledPlugin,
    contribution: Extract<PluginContribution, { kind: "canvas-app" }>,
    sourceCanvasInstanceId?: string
  ): Promise<void> => {
    const existing = workspace.pluginCanvas.find((instance) => (
      instance.pluginId === plugin.manifest.id && instance.contributionId === contribution.id
    ));
    if (existing) {
      setSettingsOpen(false);
      isHomeCamera.current = false;
      setCamera(focusCamera(existing.position, existing.size, PLUGIN_CANVAS_FOCUS_ZOOM));
      return;
    }
    const index = workspace.pluginCanvas.length;
    const homeSize = homeGridPixelSize(settings.homeGridSize);
    const source = sourceCanvasInstanceId
      ? workspace.pluginCanvas.find((instance) => instance.id === sourceCanvasInstanceId)
      : null;
    const instance = {
      id: crypto.randomUUID(),
      pluginId: plugin.manifest.id,
      contributionId: contribution.id,
      title: contribution.title,
      position: source ? {
        x: source.position.x + source.size.width + 40,
        y: source.position.y
      } : {
        x: homeSize.width + 160 + (index % 2) * 760,
        y: Math.floor(index / 2) * 500 + 20
      },
      size: contribution.defaultSize
    };
    await window.canvasTTY.workspace.setPluginCanvas([...workspace.pluginCanvas, instance]);
    setSettingsOpen(false);
    isHomeCamera.current = false;
    setCamera(focusCamera(instance.position, instance.size, PLUGIN_CANVAS_FOCUS_ZOOM));
  }, [settings.homeGridSize, workspace.pluginCanvas]);

  const openPluginContribution = useCallback(async (
    plugin: InstalledPlugin,
    contribution: PluginContribution
  ): Promise<void> => {
    if (contribution.kind === "window") {
      await window.canvasTTY.plugins.openWindow(plugin.manifest.id, contribution.id);
      return;
    }
    if (contribution.kind === "home-widget") {
      await toggleHomeWidget(`plugin:${plugin.manifest.id}:${contribution.id}`, contribution.defaultSize);
      return;
    }
    await openPluginCanvasContribution(plugin, contribution);
  }, [openPluginCanvasContribution, toggleHomeWidget]);

  useEffect(() => window.canvasTTY.plugins.onOpenCanvas((request) => {
    const plugin = plugins.find((candidate) => candidate.manifest.id === request.pluginId);
    const contribution = plugin?.manifest.contributions.find((candidate) => candidate.id === request.contributionId);
    if (!plugin || !contribution || contribution.kind !== "canvas-app" || !plugin.enabled) {
      showToast(t(settings.locale, "pluginActionFailed"));
      return;
    }
    void openPluginCanvasContribution(plugin, contribution, request.sourceCanvasInstanceId)
      .catch((error) => showToast(error instanceof Error ? error.message : t(settings.locale, "pluginActionFailed")));
  }), [openPluginCanvasContribution, plugins, settings.locale, showToast]);

  const startHomeEditor = useCallback((): void => {
    setSettingsOpen(false);
    setHomeEditDraft({
      homeGridSize: { ...settings.homeGridSize },
      homeLayout: structuredClone(settings.homeLayout)
    });
    isHomeCamera.current = true;
    setCamera(homeCamera(settings.homeGridSize));
  }, [settings.homeGridSize, settings.homeLayout]);

  const finishHomeEditor = useCallback(async (): Promise<void> => {
    if (!homeEditDraft || !homeLayoutFitsGrid(homeEditDraft.homeLayout, homeEditDraft.homeGridSize)) return;
    try {
      const updated = await window.canvasTTY.settings.update(homeEditDraft);
      setSettings(updated);
      setHomeEditDraft(null);
    } catch {
      showToast(t(settings.locale, "settingsFailed"));
    }
  }, [homeEditDraft, settings.locale, showToast]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editable = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const paletteShortcut = event.key.toLowerCase() === "p" && event.shiftKey
        && (window.canvasTTY.window.isMacOS ? event.metaKey : event.ctrlKey);
      if (paletteShortcut && !editable && !isShortcutCaptureTarget(event.target) && !isRenameInputTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        setCommandPaletteOpen(true);
        return;
      }
      if (event.repeat || editable || isShortcutCaptureTarget(event.target) || isRenameInputTarget(event.target)) return;
      if (matchesShortcut(event, settings.shortcuts.home)) {
        event.preventDefault();
        event.stopPropagation();
        goHome();
        return;
      }
      if (matchesShortcut(event, settings.shortcuts.renameWindow)) {
        event.preventDefault();
        event.stopPropagation();
        if (!activeSessionId) {
          showToast(t(settings.locale, "selectWindowToRename"));
          return;
        }
        setRenamingSessionId(activeSessionId);
      }
    };

    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [activeSessionId, goHome, settings.locale, settings.shortcuts, showToast]);

  const appearance = resolveAppearanceSettings(settings);
  const workspaceSessions = useMemo(
    () => sessions.filter((session) => session.workspaceId === workspace.id),
    [sessions, workspace.id]
  );
  const workspaceLiveCounts = useMemo(() => sessions.reduce<Record<string, number>>((counts, session) => {
    if (session.exitCode === null) counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1;
    return counts;
  }, {}), [sessions]);
  const rootClasses = useMemo(
    () => [
      "app",
      `app--${settings.palette}`,
      `app--home-${appearance.homeAccentPreset}`,
      `app--canvas-${appearance.canvasColor}`,
      windowState.isMacOS ? "app--macos" : "",
      windowState.isMacOS && windowState.fullscreen ? "app--macos-fullscreen" : ""
    ].filter(Boolean).join(" "),
    [appearance.canvasColor, appearance.homeAccentPreset, settings.palette, windowState.fullscreen, windowState.isMacOS]
  );
  const rootStyle = useMemo(
    () => appearance.homeAccentPreset === "custom"
      ? customHomeAccentStyle(appearance.homeAccentColors)
      : undefined,
    [appearance.homeAccentColors, appearance.homeAccentPreset]
  );
  const workspaceSettings = useMemo(() => ({
    ...settings,
    ...(homeEditDraft ? {
      homeGridSize: homeEditDraft.homeGridSize,
      homeLayout: homeEditDraft.homeLayout
    } : {}),
    pluginCanvas: workspace.pluginCanvas,
    browserCanvas: workspace.browserCanvas
  }), [homeEditDraft, settings, workspace.browserCanvas, workspace.pluginCanvas]);
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const ru = settings.locale === "ru";
    return [
      { id: "actions", title: ru ? "Открыть действия проекта" : "Open Project Actions", group: ru ? "Навигация" : "Navigation", run: () => { setWorkspacePanelOpen(false); setActionsOpen(true); } },
      { id: "workspace", title: ru ? "Настроить workspace" : "Manage workspace", group: ru ? "Навигация" : "Navigation", run: () => { setActionsOpen(false); setWorkspacePanelOpen(true); } },
      { id: "terminal", title: ru ? "Новый терминал" : "New terminal", group: ru ? "Создать" : "Create", run: () => void openTerminal() },
      { id: "arrange-grid", title: ru ? "Расставить карточки сеткой" : "Arrange cards in grid", group: ru ? "Раскладка" : "Layout", run: () => void autoArrangeWorkspace("grid") },
      { id: "save-view", title: ru ? "Сохранить текущий вид" : "Save current view", group: ru ? "Раскладка" : "Layout", run: () => void saveWorkspaceView({ title: `${ru ? "Вид" : "View"} ${workspace.savedViews.length + 1}`, camera }) },
      ...workspace.savedViews.map((view): PaletteCommand => ({ id: `view:${view.id}`, title: `${ru ? "Открыть вид" : "Open view"}: ${view.title}`, group: ru ? "Сохранённые виды" : "Saved views", run: () => setCamera(view.camera) })),
      ...workspace.templates.map((template): PaletteCommand => ({ id: `template:${template.id}`, title: `${ru ? "Запустить шаблон" : "Run template"}: ${template.title}`, group: ru ? "Шаблоны" : "Templates", run: () => void runTerminalTemplate(template.id) })),
      ...workspace.actions.map((action): PaletteCommand => ({ id: `action:${action.id}`, title: action.title, subtitle: action.description || action.command, group: ru ? "Действия" : "Actions", run: () => void runProjectAction(action) }))
    ];
  }, [autoArrangeWorkspace, camera, openTerminal, runProjectAction, runTerminalTemplate, saveWorkspaceView, settings.locale, workspace.actions, workspace.savedViews, workspace.templates]);

  return (
    <div className={rootClasses} style={rootStyle}>
      <TitleBar
        locale={settings.locale}
        windowState={windowState}
        workspaceTitle={workspace.title}
        workspaceId={workspace.id}
        workspaceCatalog={workspaceCatalog}
        workspaceLiveCounts={workspaceLiveCounts}
        onRenameWorkspace={renameWorkspace}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={createWorkspace}
        onDuplicateWorkspace={duplicateWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        onOpenWorkspaceManager={() => { setActionsOpen(false); setSettingsOpen(false); setWorkspacePanelOpen(true); }}
        onWindowStateChange={setWindowState}
      />
      <main className="app__content">
        {!ready && <div className="loading-screen">{t(settings.locale, "loading")}</div>}
        <WorkspaceCanvas
          settings={workspaceSettings}
          mediaData={mediaData}
          sessions={workspaceSessions}
          workspaceTerminals={workspace.terminals}
          groups={workspace.groups}
          limits={limits}
          limitsLoadState={limitsLoadState}
          plugins={plugins}
          browser={browser}
          browserViewVisible={!settingsOpen && !actionsOpen && !workspacePanelOpen && !commandPaletteOpen && launchProvider === null}
          homeEditing={homeEditDraft !== null}
          camera={camera}
          onCameraChange={changeCamera}
          onGoHome={goHome}
          onOpenSettings={() => {
            setActionsOpen(false);
            setWorkspacePanelOpen(false);
            setSettingsOpen(true);
          }}
          onOpenActions={() => {
            setSettingsOpen(false);
            setWorkspacePanelOpen(false);
            setLaunchProvider(null);
            setActionsOpen(true);
          }}
          onOpenWorkspace={() => {
            setSettingsOpen(false);
            setActionsOpen(false);
            setLaunchProvider(null);
            setWorkspacePanelOpen(true);
          }}
          onOpenAgent={(provider) => {
            setActionsOpen(false);
            setWorkspacePanelOpen(false);
            setLaunchProvider(provider);
          }}
          onOpenTerminal={() => void openTerminal()}
          onOpenBrowser={openBrowserFromUi}
          onRequestMedia={requestMedia}
          onRemoveMedia={removeMedia}
          onHomeLayoutChange={changeHomeLayout}
          onHomeGridSizeChange={changeHomeGridSize}
          onFinishHomeEdit={() => void finishHomeEditor()}
          onResetHomeLayout={resetHomeLayout}
          onPluginError={showToast}
          onPluginCanvasBoundsChange={changePluginCanvasBounds}
          onDisposePluginCanvas={disposePluginCanvas}
          onFocusPluginCanvas={focusPluginCanvas}
          onFocusSession={focusSession}
          activeSessionId={activeSessionId}
          browserSelected={browserSelected}
          renamingSessionId={renamingSessionId}
          onSelectSession={(id) => {
            setBrowserSelected(false);
            setActiveSessionId(id);
          }}
          onSelectBrowser={() => {
            setActiveSessionId(null);
            setBrowserSelected(true);
          }}
          onClearCanvasSelection={() => {
            setActiveSessionId(null);
            setBrowserSelected(false);
          }}
          onRenameSession={renameSession}
          onRenameEnd={() => setRenamingSessionId(null)}
          onSessionBoundsChange={changeSessionBounds}
          onRestartSession={restartSession}
          onDisposeSession={disposeSession}
          onStartWorkspaceTerminal={startWorkspaceTerminal}
          onWorkspaceTerminalBoundsChange={changeWorkspaceTerminalBounds}
          onRemoveWorkspaceTerminal={removeWorkspaceTerminal}
          onMoveGroup={moveWorkspaceGroup}
          onUpdateGroup={updateWorkspaceGroup}
          onBrowserBoundsChange={changeBrowserBounds}
          onFocusBrowser={focusBrowser}
          onCloseBrowser={() => void closeBrowser()}
        />
      </main>

      <ActionsPanel
        open={actionsOpen}
        locale={settings.locale}
        workspaceTitle={workspace.title}
        actions={workspace.actions}
        approvals={actionApprovals}
        runs={actionRuns.filter((run) => run.workspaceId === workspace.id)}
        sessions={workspaceSessions}
        defaultCwd={workspace.projectRoot || settings.lastDirectory}
        onClose={() => setActionsOpen(false)}
        onCreate={createProjectAction}
        onUpdate={updateProjectAction}
        onRemove={removeProjectAction}
        onRun={runProjectAction}
        onStop={stopProjectAction}
        onRetry={retryProjectAction}
        onApprove={approveProjectAction}
        onDiscover={discoverProjectActions}
        onImport={importProjectActions}
        onChooseFolder={(defaultPath) => window.canvasTTY.dialog.pickDirectory(defaultPath)}
      />

      <WorkspacePanel
        open={workspacePanelOpen}
        locale={settings.locale}
        workspace={workspace}
        catalog={workspaceCatalog}
        camera={camera}
        defaultCwd={settings.lastDirectory}
        onClose={() => setWorkspacePanelOpen(false)}
        onSetProjectRoot={setProjectRoot}
        onChooseFolder={(defaultPath) => window.canvasTTY.dialog.pickDirectory(defaultPath)}
        onCreateGroup={createWorkspaceGroup}
        onUpdateGroup={updateWorkspaceGroup}
        onRemoveGroup={removeWorkspaceGroup}
        onArrange={autoArrangeWorkspace}
        onSaveView={saveWorkspaceView}
        onRemoveView={removeWorkspaceView}
        onApplyView={(savedCamera) => { setCamera(savedCamera); void window.canvasTTY.workspace.setCamera(savedCamera); }}
        onCreateTemplate={createTerminalTemplate}
        onRemoveTemplate={removeTerminalTemplate}
        onRunTemplate={runTerminalTemplate}
        onSavePreset={saveWorkspacePreset}
        onRemovePreset={removeWorkspacePreset}
        onCreateFromPreset={createWorkspace}
        onExport={exportWorkspace}
        onImport={importWorkspace}
      />
      <CommandPalette open={commandPaletteOpen} locale={settings.locale} commands={paletteCommands} onClose={() => setCommandPaletteOpen(false)} />

      <AgentLaunchDialog
        provider={launchProvider}
        settings={settings}
        onClose={() => setLaunchProvider(null)}
        onAcknowledge={acknowledgeDanger}
        onLaunch={launchAgent}
      />
      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        plugins={plugins}
        browser={browser}
        onClose={() => setSettingsOpen(false)}
        onChange={saveSettings}
        onPreviewPlugin={previewPlugin}
        onInstallPlugin={installPlugin}
        onSearchPlugins={searchPlugins}
        onShowcasePlugins={showcasePlugins}
        onFetchPluginIcons={fetchPluginIcons}
        onPreviewManifests={previewManifests}
        onCheckPluginUpdates={checkPluginUpdates}
        onUpdatePlugin={updatePlugin}
        onSetPluginModules={setPluginModules}
        onSetPluginEnabled={setPluginEnabled}
        onUninstallPlugin={uninstallPlugin}
        onOpenPluginContribution={openPluginContribution}
        onToggleHomeWidget={toggleHomeWidget}
        onEditHome={startHomeEditor}
        onOpenBrowser={openBrowser}
      />
      <Toast message={toast} />
    </div>
  );
}

function nextSessionPosition(index: number, homeGridSize: HomeGridSize): Point {
  const homeSize = homeGridPixelSize(homeGridSize);
  return {
    x: homeSize.width + 160 + (index % 2) * 760,
    y: Math.floor(index / 2) * 500 + 20
  };
}

function homeCamera(homeGridSize: HomeGridSize): CameraState {
  const { width: viewportWidth, height: viewportHeight } = canvasViewportSize();
  const homeSize = homeGridPixelSize(homeGridSize);
  const availableZoom = Math.min(
    1,
    (viewportWidth - 80) / homeSize.width,
    (viewportHeight - 72) / homeSize.height
  );
  const zoom = [1, 0.9, 0.8, 0.75, 2 / 3, 0.5, 0.4, 1 / 3, 0.28, 0.25, 0.2]
    .find((step) => step <= availableZoom) ?? 0.2;
  return {
    zoom,
    x: Math.round((viewportWidth - homeSize.width * zoom) / 2),
    y: Math.round((viewportHeight - homeSize.height * zoom) / 2)
  };
}

function focusCamera(
  position: Point,
  size: { width: number; height: number },
  zoom = DEFAULT_FOCUS_ZOOM
): CameraState {
  const { width: viewportWidth, height: viewportHeight } = canvasViewportSize();
  return {
    zoom,
    x: viewportWidth / 2 - (position.x + size.width / 2) * zoom,
    y: viewportHeight / 2 - (position.y + size.height / 2) * zoom
  };
}

function canvasViewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1360, height: 820 };
  const content = document.querySelector<HTMLElement>(".app__content");
  return {
    width: content?.clientWidth || window.innerWidth,
    height: content?.clientHeight || window.innerHeight
  };
}
