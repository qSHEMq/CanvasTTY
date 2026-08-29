import { contextBridge, ipcRenderer } from "electron";
import type {
  ActionApprovalEvent,
  ActionRunEvent,
  AppSettings,
  BrowserActivityStateEvent,
  BrowserCanvasFreezeFrameEvent,
  BrowserCanvasNavigationPointerEvent,
  BrowserCanvasPointerEvent,
  BrowserCanvasState,
  BrowserCanvasWheelEvent,
  BrowserCommand,
  BrowserStateEvent,
  BrowserViewportBounds,
  CanvasNavigationOverrideStateEvent,
  CanvasTTYApi,
  CameraState,
  CreateSessionRequest,
  PluginBrowserOpenRequest,
  PluginBrowserOpenResponse,
  PluginCanvasRequest,
  PluginCanvasInstance,
  PluginLauncherRequest,
  PluginStorageChangeEvent,
  PluginUpdateStatus,
  ProjectActionInput,
  ProjectActionUpdate,
  Point,
  RunProjectActionRequest,
  SessionBounds,
  SessionEvent,
  SessionRemovedEvent,
  TerminalDataEvent,
  WorkspaceEvent,
  WorkspaceArrangeMode,
  WorkspaceCatalogEvent,
  WorkspaceCreateInput,
  WorkspaceGroupInput,
  WorkspaceGroupUpdate,
  WorkspacePresetInput,
  WorkspaceSavedViewInput,
  TerminalTemplateInput,
  TerminalTemplateUpdate,
  WorkspaceTerminalBoundsRequest
} from "../shared/contracts";
import { IPC } from "../shared/contracts";

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: CanvasTTYApi = {
  appVersion: () => ipcRenderer.invoke(IPC.appVersion),
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeText: (text: string) => ipcRenderer.send(IPC.clipboardWrite, text)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  workspace: {
    catalog: () => ipcRenderer.invoke(IPC.workspaceCatalog),
    get: () => ipcRenderer.invoke(IPC.workspaceGet),
    create: (input: WorkspaceCreateInput) => ipcRenderer.invoke(IPC.workspaceCreate, input),
    switch: (id: string) => ipcRenderer.invoke(IPC.workspaceSwitch, id),
    duplicate: (id: string, title?: string) => ipcRenderer.invoke(IPC.workspaceDuplicate, id, title),
    delete: (id: string) => ipcRenderer.invoke(IPC.workspaceDelete, id),
    rename: (title: string) => ipcRenderer.invoke(IPC.workspaceRename, title),
    setProjectRoot: (path: string) => ipcRenderer.invoke(IPC.workspaceProjectRoot, path),
    setCamera: (camera: CameraState) => ipcRenderer.invoke(IPC.workspaceCamera, camera),
    startTerminal: (id: string) => ipcRenderer.invoke(IPC.workspaceStartTerminal, id),
    setTerminalBounds: (request: WorkspaceTerminalBoundsRequest) => (
      ipcRenderer.invoke(IPC.workspaceTerminalBounds, request)
    ),
    removeTerminal: (id: string) => ipcRenderer.invoke(IPC.workspaceRemoveTerminal, id),
    setPluginCanvas: (instances: PluginCanvasInstance[]) => ipcRenderer.invoke(IPC.workspacePluginCanvas, instances),
    setBrowserCanvas: (bounds: BrowserCanvasState | null) => ipcRenderer.invoke(IPC.workspaceBrowserCanvas, bounds),
    createGroup: (input: WorkspaceGroupInput) => ipcRenderer.invoke(IPC.workspaceGroupCreate, input),
    updateGroup: (input: WorkspaceGroupUpdate) => ipcRenderer.invoke(IPC.workspaceGroupUpdate, input),
    moveGroup: (id: string, position: Point) => ipcRenderer.invoke(IPC.workspaceGroupMove, id, position),
    removeGroup: (id: string, removeMembers?: boolean) => ipcRenderer.invoke(IPC.workspaceGroupRemove, id, removeMembers),
    autoArrange: (mode: WorkspaceArrangeMode, objectIds?: string[]) => ipcRenderer.invoke(IPC.workspaceAutoArrange, mode, objectIds),
    saveView: (input: WorkspaceSavedViewInput) => ipcRenderer.invoke(IPC.workspaceViewSave, input),
    removeView: (id: string) => ipcRenderer.invoke(IPC.workspaceViewRemove, id),
    createTemplate: (input: TerminalTemplateInput) => ipcRenderer.invoke(IPC.workspaceTemplateCreate, input),
    updateTemplate: (input: TerminalTemplateUpdate) => ipcRenderer.invoke(IPC.workspaceTemplateUpdate, input),
    removeTemplate: (id: string) => ipcRenderer.invoke(IPC.workspaceTemplateRemove, id),
    runTemplate: (id: string, position: Point) => ipcRenderer.invoke(IPC.workspaceTemplateRun, id, position),
    savePreset: (input: WorkspacePresetInput) => ipcRenderer.invoke(IPC.workspacePresetSave, input),
    removePreset: (id: string) => ipcRenderer.invoke(IPC.workspacePresetRemove, id),
    export: () => ipcRenderer.invoke(IPC.workspaceExport),
    import: (raw: string) => ipcRenderer.invoke(IPC.workspaceImport, raw),
    onChanged: (listener: (event: WorkspaceEvent) => void) => subscribe(IPC.workspaceChanged, listener),
    onCatalogChanged: (listener: (event: WorkspaceCatalogEvent) => void) => subscribe(IPC.workspaceCatalogChanged, listener)
  },
  actions: {
    list: () => ipcRenderer.invoke(IPC.actionsList),
    runs: () => ipcRenderer.invoke(IPC.actionsRuns),
    create: (input: ProjectActionInput) => ipcRenderer.invoke(IPC.actionsCreate, input),
    update: (input: ProjectActionUpdate) => ipcRenderer.invoke(IPC.actionsUpdate, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.actionsRemove, id),
    run: (request: RunProjectActionRequest) => ipcRenderer.invoke(IPC.actionsRun, request),
    approve: (token: string) => ipcRenderer.invoke(IPC.actionsApprove, token),
    stop: (runId: string) => ipcRenderer.invoke(IPC.actionsStop, runId),
    retry: (runId: string, stepId?: string) => ipcRenderer.invoke(IPC.actionsRetry, runId, stepId),
    discover: (root: string) => ipcRenderer.invoke(IPC.actionsDiscover, root),
    import: (inputs: ProjectActionInput[]) => ipcRenderer.invoke(IPC.actionsImport, inputs),
    onRun: (listener: (event: ActionRunEvent) => void) => subscribe(IPC.actionsRunChanged, listener),
    onApproval: (listener: (event: ActionApprovalEvent) => void) => subscribe(IPC.actionsApprovalRequested, listener)
  },
  dialog: {
    pickDirectory: (defaultPath?: string) => ipcRenderer.invoke(IPC.dialogPickDirectory, defaultPath),
    pickMedia: () => ipcRenderer.invoke(IPC.dialogPickMedia)
  },
  media: {
    read: (path: string) => ipcRenderer.invoke(IPC.mediaRead, path)
  },
  limits: {
    get: () => ipcRenderer.invoke(IPC.limitsGet)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.pluginsList),
    search: (query: string) => ipcRenderer.invoke(IPC.pluginsSearch, query),
    showcase: () => ipcRenderer.invoke(IPC.pluginsShowcase),
    icon: (sourceUrls: string[]) => ipcRenderer.invoke(IPC.pluginsIcon, sourceUrls),
    manifests: (sourceUrls: string[]) => ipcRenderer.invoke(IPC.pluginsManifests, sourceUrls),
    checkUpdates: () => ipcRenderer.invoke(IPC.pluginsCheckUpdates),
    update: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsUpdate, pluginId),
    onUpdatesAvailable: (listener: (updates: PluginUpdateStatus[]) => void) => subscribe(IPC.pluginsUpdatesAvailable, listener),
    previewInstall: (sourceUrl: string) => ipcRenderer.invoke(IPC.pluginsPreviewInstall, sourceUrl),
    install: (token: string, selectedModules?: string[]) => ipcRenderer.invoke(IPC.pluginsInstall, token, selectedModules),
    setModules: (pluginId: string, selectedModules: string[]) => (
      ipcRenderer.invoke(IPC.pluginsSetModules, pluginId, selectedModules)
    ),
    setEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke(IPC.pluginsSetEnabled, pluginId, enabled),
    uninstall: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsUninstall, pluginId),
    openCanvas: (pluginId: string, contributionId: string, sourceCanvasInstanceId?: string) => (
      ipcRenderer.invoke(IPC.pluginsOpenCanvas, pluginId, contributionId, sourceCanvasInstanceId)
    ),
    openWindow: (pluginId: string, contributionId: string) => ipcRenderer.invoke(IPC.pluginsOpenWindow, pluginId, contributionId),
    openExternal: (pluginId: string, url: string) => ipcRenderer.invoke(IPC.pluginsOpenExternal, pluginId, url),
    openBrowser: (pluginId: string, url: string) => ipcRenderer.invoke(IPC.pluginsOpenBrowser, pluginId, url),
    storageGet: (pluginId: string, key: string) => ipcRenderer.invoke(IPC.pluginsStorageGet, pluginId, key),
    storageSet: (pluginId: string, key: string, value: unknown) => ipcRenderer.invoke(IPC.pluginsStorageSet, pluginId, key, value),
    secretsGet: (pluginId: string, key: string) => ipcRenderer.invoke(IPC.pluginsSecretsGet, pluginId, key),
    secretsSet: (pluginId: string, key: string, value: string) => ipcRenderer.invoke(IPC.pluginsSecretsSet, pluginId, key, value),
    secretsDelete: (pluginId: string, key: string) => ipcRenderer.invoke(IPC.pluginsSecretsDelete, pluginId, key),
    mediaPickLibrary: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsMediaPickLibrary, pluginId),
    mediaListLibraries: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsMediaListLibraries, pluginId),
    mediaScanLibrary: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsMediaScanLibrary, pluginId, libraryId),
    mediaRevokeLibrary: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsMediaRevokeLibrary, pluginId, libraryId),
    playlistsList: (pluginId: string, libraryId: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsList, pluginId, libraryId),
    playlistsRead: (pluginId: string, libraryId: string, playlistId: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsRead, pluginId, libraryId, playlistId),
    playlistsWrite: (pluginId: string, libraryId: string, name: string, content: string) => ipcRenderer.invoke(IPC.pluginsPlaylistsWrite, pluginId, libraryId, name, content),
    hermesHudStatus: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsHermesHudStatus, pluginId),
    hermesHudOpen: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsHermesHudOpen, pluginId),
    hermesHudClose: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsHermesHudClose, pluginId),
    actionsList: (pluginId: string) => ipcRenderer.invoke(IPC.pluginsActionsList, pluginId),
    actionsRun: (pluginId: string, actionId: string, idempotencyKey?: string) => ipcRenderer.invoke(IPC.pluginsActionsRun, pluginId, actionId, idempotencyKey),
    onOpenLauncher: (listener: (event: PluginLauncherRequest) => void) => subscribe(IPC.pluginsLauncherRequested, listener),
    onOpenCanvas: (listener: (event: PluginCanvasRequest) => void) => subscribe(IPC.pluginsCanvasRequested, listener),
    onBrowserOpenRequested: (listener: (event: PluginBrowserOpenRequest) => void) => (
      subscribe(IPC.pluginsBrowserOpenRequested, listener)
    ),
    completeBrowserOpen: (response: PluginBrowserOpenResponse) => (
      ipcRenderer.invoke(IPC.pluginsBrowserOpenResponded, response)
    ),
    onStorageChanged: (listener: (event: PluginStorageChangeEvent) => void) => subscribe(IPC.pluginsStorageChanged, listener)
  },
  githubAuth: {
    status: () => ipcRenderer.invoke(IPC.githubAuthStatus),
    start: () => ipcRenderer.invoke(IPC.githubAuthStart),
    signOut: () => ipcRenderer.invoke(IPC.githubAuthSignOut),
    openUrl: (url: string) => ipcRenderer.invoke(IPC.githubAuthOpenUrl, url)
  },
  browser: {
    getState: () => ipcRenderer.invoke(IPC.browserGetState),
    open: (url?: string) => ipcRenderer.invoke(IPC.browserOpen, url),
    close: () => ipcRenderer.invoke(IPC.browserClose),
    closeAllTabs: () => ipcRenderer.invoke(IPC.browserCloseAllTabs),
    newTab: (url?: string) => ipcRenderer.invoke(IPC.browserNewTab, url),
    selectTab: (id: string) => ipcRenderer.invoke(IPC.browserSelectTab, id),
    closeTab: (id: string) => ipcRenderer.invoke(IPC.browserCloseTab, id),
    navigate: (id: string, value: string) => ipcRenderer.invoke(IPC.browserNavigate, id, value),
    back: (id: string) => ipcRenderer.invoke(IPC.browserBack, id),
    forward: (id: string) => ipcRenderer.invoke(IPC.browserForward, id),
    reload: (id: string) => ipcRenderer.invoke(IPC.browserReload, id),
    execute: (command: BrowserCommand) => ipcRenderer.invoke(IPC.browserExecute, command),
    getActivity: (sinceSequence?: number) => ipcRenderer.invoke(IPC.browserGetActivity, sinceSequence),
    clearData: () => ipcRenderer.invoke(IPC.browserClearData),
    focus: () => ipcRenderer.send(IPC.browserFocus),
    setInputFocused: (focused: boolean) => {
      ipcRenderer.sendSync(IPC.browserSetInputFocused, focused);
    },
    setViewport: (bounds: BrowserViewportBounds) => ipcRenderer.send(IPC.browserSetViewport, bounds),
    onState: (listener: (event: BrowserStateEvent) => void) => subscribe(IPC.browserState, listener),
    onActivity: (listener: (event: BrowserActivityStateEvent) => void) => subscribe(IPC.browserActivity, listener),
    onCanvasWheel: (listener: (event: BrowserCanvasWheelEvent) => void) => subscribe(IPC.browserCanvasWheel, listener),
    onCanvasFreezeFrame: (listener: (event: BrowserCanvasFreezeFrameEvent) => void) => (
      subscribe(IPC.browserCanvasFreezeFrame, listener)
    ),
    onCanvasPointer: (listener: (event: BrowserCanvasPointerEvent) => void) => subscribe(IPC.browserCanvasPointer, listener),
    onCanvasNavigationPointer: (listener: (event: BrowserCanvasNavigationPointerEvent) => void) => (
      subscribe(IPC.browserCanvasNavigationPointer, listener)
    )
  },
  canvasNavigation: {
    armOwnerWheelSequence: (clientX: number, clientY: number) => {
      ipcRenderer.sendSync(IPC.canvasNavigationOwnerWheel, { clientX, clientY });
    },
    setShortcutCaptureActive: (active: boolean) => ipcRenderer.send(IPC.canvasNavigationShortcutCapture, active),
    setPointerGestureActive: (active: boolean) => ipcRenderer.send(IPC.canvasNavigationPointerGesture, active),
    onOverrideState: (listener: (event: CanvasNavigationOverrideStateEvent) => void) => (
      subscribe(IPC.canvasNavigationOverrideState, listener)
    )
  },
  terminal: {
    list: () => ipcRenderer.invoke(IPC.terminalList),
    create: (request: CreateSessionRequest) => ipcRenderer.invoke(IPC.terminalCreate, request),
    restart: (id: string) => ipcRenderer.invoke(IPC.terminalRestart, id),
    input: (id: string, data: string) => ipcRenderer.send(IPC.terminalInput, id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
    setBounds: (id: string, bounds: SessionBounds) => ipcRenderer.send(IPC.terminalBounds, id, bounds),
    rename: (id: string, title: string) => ipcRenderer.invoke(IPC.terminalRename, id, title),
    dispose: (id: string) => ipcRenderer.invoke(IPC.terminalDispose, id),
    onData: (listener: (event: TerminalDataEvent) => void) => subscribe(IPC.terminalData, listener),
    onSession: (listener: (event: SessionEvent) => void) => subscribe(IPC.terminalSession, listener),
    onRemoved: (listener: (event: SessionRemovedEvent) => void) => subscribe(IPC.terminalRemoved, listener)
  },
  window: {
    isMacOS: process.platform === "darwin",
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    getState: () => ipcRenderer.invoke(IPC.windowGetState),
    onState: (listener) => subscribe(IPC.windowState, listener)
  }
};

contextBridge.exposeInMainWorld("canvasTTY", api);
