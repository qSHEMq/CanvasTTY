import { useCallback, useMemo, useRef } from "react";
import type {
  AgentProviderId,
  AppSettings,
  BrowserCanvasState,
  BrowserSnapshot,
  CameraState,
  HomeGridSize,
  HomeWidgetPlacement,
  InstalledPlugin,
  LimitsSnapshot,
  SessionBounds,
  SessionSnapshot,
  Point,
  WorkspaceGroup,
  WorkspaceGroupUpdate,
  WorkspaceTerminal
} from "../../../../shared/contracts";
import { HomeZone } from "../home/HomeZone";
import { TerminalCard } from "../terminal/TerminalCard";
import { TerminalPlaceholder } from "../terminal/TerminalPlaceholder";
import { PluginCanvasCard } from "../plugins/PluginCanvasCard";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import { displayCanvasNavigationBinding } from "../../lib/shortcuts";
import type { LimitsLoadState } from "../home/homeModel";
import { homeGridPixelSize, homeLayoutFitsGrid } from "../home/homeLayout";
import { BrowserCard } from "../browser/BrowserCard";
import {
  browserCanvasWidgetId,
  canvasWidgetTarget,
  pluginCanvasWidgetId,
  terminalCanvasWidgetId
} from "./canvasWidgetFocus";
import { useCanvasPointerNavigation } from "./useCanvasPointerNavigation";
import { useCanvasWheelNavigation } from "./useCanvasWheelNavigation";
import { useCanvasWidgetFocus } from "./useCanvasWidgetFocus";
import { GroupFrame } from "./GroupFrame";

interface WorkspaceCanvasProps {
  settings: AppSettings;
  mediaData: string | null;
  sessions: SessionSnapshot[];
  workspaceTerminals: WorkspaceTerminal[];
  groups: WorkspaceGroup[];
  limits: LimitsSnapshot | null;
  limitsLoadState: LimitsLoadState;
  plugins: InstalledPlugin[];
  browser: BrowserSnapshot;
  browserViewVisible: boolean;
  homeEditing: boolean;
  camera: CameraState;
  onCameraChange(camera: CameraState): void;
  onGoHome(): void;
  onOpenSettings(): void;
  onOpenActions(): void;
  onOpenWorkspace(): void;
  onOpenAgent(provider: AgentProviderId): void;
  onOpenTerminal(): void;
  onOpenBrowser(): void;
  onFocusSession(session: SessionSnapshot): void;
  activeSessionId: string | null;
  browserSelected: boolean;
  renamingSessionId: string | null;
  onSelectSession(id: string): void;
  onSelectBrowser(): void;
  onClearCanvasSelection(): void;
  onRenameSession(id: string, title: string): Promise<void>;
  onRenameEnd(): void;
  onRequestMedia(): Promise<void>;
  onRemoveMedia(): Promise<void>;
  onHomeLayoutChange(layout: HomeWidgetPlacement[]): void;
  onHomeGridSizeChange(gridSize: HomeGridSize): void;
  onFinishHomeEdit(): void;
  onResetHomeLayout(): void;
  onPluginError(message: string): void;
  onPluginCanvasBoundsChange(id: string, bounds: SessionBounds): void;
  onDisposePluginCanvas(id: string): void;
  onFocusPluginCanvas(id: string): void;
  onSessionBoundsChange(id: string, bounds: SessionBounds): void;
  onRestartSession(id: string): Promise<void>;
  onDisposeSession(id: string): void;
  onStartWorkspaceTerminal(id: string): Promise<void>;
  onWorkspaceTerminalBoundsChange(id: string, bounds: SessionBounds): Promise<void>;
  onRemoveWorkspaceTerminal(id: string): Promise<void>;
  onMoveGroup(id: string, position: Point): Promise<void>;
  onUpdateGroup(input: WorkspaceGroupUpdate): Promise<void>;
  onBrowserBoundsChange(bounds: BrowserCanvasState): void;
  onFocusBrowser(): void;
  onCloseBrowser(): void;
}

export function WorkspaceCanvas({
  settings,
  mediaData,
  sessions,
  workspaceTerminals,
  groups,
  limits,
  limitsLoadState,
  plugins,
  browser,
  browserViewVisible,
  homeEditing,
  camera,
  onCameraChange,
  onGoHome,
  onOpenSettings,
  onOpenActions,
  onOpenWorkspace,
  onOpenAgent,
  onOpenTerminal,
  onOpenBrowser,
  onFocusSession,
  activeSessionId,
  browserSelected,
  renamingSessionId,
  onSelectSession,
  onSelectBrowser,
  onClearCanvasSelection,
  onRenameSession,
  onRenameEnd,
  onRequestMedia,
  onRemoveMedia,
  onHomeLayoutChange,
  onHomeGridSizeChange,
  onFinishHomeEdit,
  onResetHomeLayout,
  onPluginError,
  onPluginCanvasBoundsChange,
  onDisposePluginCanvas,
  onFocusPluginCanvas,
  onSessionBoundsChange,
  onRestartSession,
  onDisposeSession,
  onStartWorkspaceTerminal,
  onWorkspaceTerminalBoundsChange,
  onRemoveWorkspaceTerminal,
  onMoveGroup,
  onUpdateGroup,
  onBrowserBoundsChange,
  onFocusBrowser,
  onCloseBrowser
}: WorkspaceCanvasProps): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const commitCamera = useCallback((next: CameraState): void => {
    cameraRef.current = next;
    onCameraChange(next);
  }, [onCameraChange]);

  const focusController = useCanvasWidgetFocus({
    viewport,
    settings,
    activeSessionId,
    browserSelected,
    widgetTreeVersion: [
      browserViewVisible ? "browser-visible" : "browser-hidden",
      settings.browserCanvas ? "browser-card" : "no-browser-card",
      sessions.map((session) => session.id).join(","),
      plugins.map((plugin) => [
        plugin.manifest.id,
        plugin.enabled ? "enabled" : "disabled",
        plugin.manifest.contributions.map((contribution) => contribution.id).join(",")
      ].join(":")).join(";"),
      settings.pluginCanvas.map((instance) => instance.id).join(","),
      settings.homeLayout.map((placement) => placement.widgetId).join(",")
    ].join("|")
  });
  const wheelNavigation = useCanvasWheelNavigation({
    viewport,
    settings,
    cameraRef,
    widgetFocusRef: focusController.stateRef,
    commitCamera
  });
  const pointerNavigation = useCanvasPointerNavigation({
    viewport,
    settings,
    cameraRef,
    canvasOverrideActiveRef: wheelNavigation.canvasOverrideActiveRef,
    commitCamera
  });
  const widgetFocus = focusController.state;
  const routeWidgetWheelToCanvas = wheelNavigation.routeWidgetWheelToCanvas;
  const canvasOverrideActive = wheelNavigation.canvasOverrideActive;

  const homeBounds: SessionBounds = {
    position: { x: 0, y: 0 },
    size: homeGridPixelSize(settings.homeGridSize)
  };
  const homeLayoutValid = homeLayoutFitsGrid(settings.homeLayout, settings.homeGridSize);
  const placeholderTerminals = useMemo(() => {
    const liveObjectIds = new Set(sessions.flatMap((session) => (
      session.workspaceObjectId ? [session.workspaceObjectId] : []
    )));
    return workspaceTerminals.filter((terminal) => !liveObjectIds.has(terminal.id));
  }, [sessions, workspaceTerminals]);
  const collapsedMemberIds = useMemo(() => new Set(groups.filter((group) => group.collapsed).flatMap((group) => group.memberIds)), [groups]);
  const visibleSessions = useMemo(() => sessions.filter((session) => !session.workspaceObjectId || !collapsedMemberIds.has(session.workspaceObjectId)), [collapsedMemberIds, sessions]);
  const visiblePlaceholders = useMemo(() => placeholderTerminals.filter((terminal) => !collapsedMemberIds.has(terminal.id)), [collapsedMemberIds, placeholderTerminals]);

  return (
    <div
      ref={viewport}
      className={`workspace pattern-${settings.pattern} ${pointerNavigation.panning ? "workspace--panning" : ""} ${canvasOverrideActive ? "workspace--canvas-override" : ""}`}
      onPointerDownCapture={(event) => {
        if (pointerNavigation.handlePointerDownCapture(event)) return;
        const target = canvasWidgetTarget(event.target);
        if (target.focusableWidgetId !== null) {
          focusController.cancelHover();
          focusController.focus(target.focusableWidgetId, "explicit");
        }
        if (!(event.target as HTMLElement).closest(".terminal-card, .browser-card")) onClearCanvasSelection();
      }}
      onClickCapture={(event) => {
        if (!pointerNavigation.handleClickCapture(event)) focusController.handleClick(event);
      }}
      onPointerOverCapture={focusController.handlePointerOver}
      onPointerOutCapture={focusController.handlePointerOut}
      onPointerDown={pointerNavigation.handlePointerDown}
      onPointerMove={pointerNavigation.handlePointerMove}
      onPointerUp={pointerNavigation.handlePointerEnd}
      onPointerCancel={pointerNavigation.handlePointerEnd}
      onPointerLeave={pointerNavigation.handlePointerLeave}
    >
      <div className="workspace__scene" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
        <HomeZone
          settings={settings}
          mediaData={mediaData}
          sessions={sessions}
          limits={limits}
          limitsLoadState={limitsLoadState}
          plugins={plugins}
          editing={homeEditing}
          onOpenSettings={onOpenSettings}
          onOpenAgent={onOpenAgent}
          onOpenTerminal={onOpenTerminal}
          onOpenBrowser={() => {
            if (settings.browserCanvas) focusController.focusBrowser();
            onOpenBrowser();
          }}
          onFocusSession={(session) => {
            focusController.focus(terminalCanvasWidgetId(session.id), "explicit");
            onFocusSession(session);
          }}
          onRequestMedia={onRequestMedia}
          onRemoveMedia={onRemoveMedia}
          onLayoutChange={onHomeLayoutChange}
          onGridSizeChange={onHomeGridSizeChange}
          onPluginError={onPluginError}
          captureCanvasWheelOverWidgets={routeWidgetWheelToCanvas}
          focusedWidgetId={widgetFocus.id}
          onWidgetFocus={(id) => {
            focusController.cancelHover();
            focusController.focus(id, "explicit");
          }}
          onWidgetHoverChange={(id, active) => {
            if (active) focusController.scheduleHover(id);
            else focusController.cancelHover(id);
          }}
          onPluginCanvasWheel={wheelNavigation.applyCanvasWheel}
        />
        <div
          className={`workspace__windows ${homeEditing ? "workspace__windows--hidden" : ""}`}
          aria-hidden={homeEditing}
        >
          {groups.map((group) => <GroupFrame key={group.id} group={group} locale={settings.locale} zoom={camera.zoom} onMove={onMoveGroup} onUpdate={onUpdateGroup} />)}
          {visibleSessions.map((session) => (
            <TerminalCard
              key={session.id}
              session={session}
              locale={settings.locale}
              palette={settings.palette}
              zoom={camera.zoom}
              snapEnabled={settings.snapToGrid}
              focusActivation={settings.focusActivation}
              invertTerminalWheel={settings.invertTerminalWheel}
              captureCanvasWheelOverWidgets={routeWidgetWheelToCanvas || widgetFocus.id !== terminalCanvasWidgetId(session.id)}
              focused={widgetFocus.id === terminalCanvasWidgetId(session.id)}
              focusChangeSource={widgetFocus.source}
              selected={activeSessionId === session.id}
              renaming={renamingSessionId === session.id}
              snapTargets={[
                homeBounds,
                ...visibleSessions
                  .filter((candidate) => candidate.id !== session.id)
                  .map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...visiblePlaceholders.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...settings.pluginCanvas.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...(settings.browserCanvas ? [settings.browserCanvas] : [])
              ]}
              onActivate={(selectedSession) => {
                focusController.focus(terminalCanvasWidgetId(selectedSession.id), "explicit");
                onFocusSession(selectedSession);
              }}
              onSelect={onSelectSession}
              onRename={onRenameSession}
              onRenameEnd={onRenameEnd}
              onBoundsChange={onSessionBoundsChange}
              onRestart={onRestartSession}
              onDispose={onDisposeSession}
            />
          ))}
          {visiblePlaceholders.map((terminal) => (
            <TerminalPlaceholder
              key={terminal.id}
              terminal={terminal}
              locale={settings.locale}
              zoom={camera.zoom}
              snapEnabled={settings.snapToGrid}
              snapTargets={[
                homeBounds,
                ...visibleSessions.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...visiblePlaceholders
                  .filter((candidate) => candidate.id !== terminal.id)
                  .map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...settings.pluginCanvas.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...(settings.browserCanvas ? [settings.browserCanvas] : [])
              ]}
              onStart={onStartWorkspaceTerminal}
              onBoundsChange={onWorkspaceTerminalBoundsChange}
              onRemove={onRemoveWorkspaceTerminal}
            />
          ))}
          {settings.pluginCanvas.map((instance) => {
            if (collapsedMemberIds.has(instance.id)) return null;
            const plugin = plugins.find((candidate) => candidate.manifest.id === instance.pluginId && candidate.enabled);
            const contribution = plugin?.manifest.contributions.find((candidate) => candidate.id === instance.contributionId);
            if (!plugin || !contribution || contribution.kind !== "canvas-app") return null;
            return (
              <PluginCanvasCard
                key={instance.id}
                instance={instance}
                plugin={plugin}
                contribution={contribution}
                locale={settings.locale}
                palette={settings.palette}
                zoom={camera.zoom}
                snapEnabled={settings.snapToGrid}
                sessions={sessions}
                limits={limits}
                snapTargets={[
                  homeBounds,
                  ...visibleSessions.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                  ...visiblePlaceholders.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                  ...settings.pluginCanvas
                    .filter((candidate) => candidate.id !== instance.id)
                    .map((candidate) => ({ position: candidate.position, size: candidate.size })),
                  ...(settings.browserCanvas ? [settings.browserCanvas] : [])
                ]}
                onActivate={() => {
                  focusController.focus(pluginCanvasWidgetId(instance.id), "explicit");
                  onFocusPluginCanvas(instance.id);
                }}
                onBoundsChange={onPluginCanvasBoundsChange}
                onDispose={onDisposePluginCanvas}
                onOpenLauncher={(provider) => provider === "terminal" ? onOpenTerminal() : onOpenAgent(provider)}
                onError={onPluginError}
                captureCanvasWheelOverWidgets={routeWidgetWheelToCanvas || widgetFocus.id !== pluginCanvasWidgetId(instance.id)}
                onWidgetFocus={() => {
                  focusController.cancelHover();
                  focusController.focus(pluginCanvasWidgetId(instance.id), "explicit");
                }}
                onWidgetHoverChange={(active) => {
                  if (active) focusController.scheduleHover(pluginCanvasWidgetId(instance.id));
                  else focusController.cancelHover(pluginCanvasWidgetId(instance.id));
                }}
                onCanvasWheel={wheelNavigation.applyCanvasWheel}
              />
            );
          })}
          {settings.browserCanvas && !collapsedMemberIds.has("browser") && (
            <BrowserCard
              browser={browser}
              bounds={settings.browserCanvas}
              locale={settings.locale}
              zoom={camera.zoom}
              camera={camera}
              visible={browserViewVisible && !homeEditing}
              snapEnabled={settings.snapToGrid}
              focusActivation={settings.focusActivation}
              focused={widgetFocus.id === browserCanvasWidgetId}
              selected={browserSelected}
              showAgentPresence={settings.browserShowAgentPresence}
              snapTargets={[
                homeBounds,
                ...visibleSessions.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...visiblePlaceholders.map((candidate) => ({ position: candidate.position, size: candidate.size })),
                ...settings.pluginCanvas.map((candidate) => ({ position: candidate.position, size: candidate.size }))
              ]}
              onBoundsChange={onBrowserBoundsChange}
              onActivate={() => {
                focusController.focusBrowser();
                onFocusBrowser();
              }}
              onSelect={onSelectBrowser}
              onWidgetFocus={focusController.focusBrowser}
              onWidgetHoverChange={focusController.hoverBrowser}
              onClose={onCloseBrowser}
              onError={onPluginError}
            />
          )}
        </div>
      </div>

      {homeEditing && (
        <div className="home-editor-toolbar" data-interactive="true">
          <strong>{t(settings.locale, "homeEditor")}</strong>
          <button type="button" onClick={onResetHomeLayout}>{t(settings.locale, "resetHome")}</button>
          <button
            className="home-editor-toolbar__done"
            type="button"
            disabled={!homeLayoutValid}
            title={homeLayoutValid ? undefined : t(settings.locale, "homeLayoutOutside")}
            onClick={onFinishHomeEdit}
          >{t(settings.locale, "doneEditing")}</button>
        </div>
      )}

      <div className="canvas-controls" data-interactive="true">
        <button type="button" onClick={onGoHome} title={t(settings.locale, "home")}><UiIcon name="home" size={17} /></button>
        <button type="button" onClick={onOpenActions} title={t(settings.locale, "projectActions")}><UiIcon name="bolt" size={17} /></button>
        <button type="button" onClick={onOpenWorkspace} title={settings.locale === "ru" ? "Настроить workspace" : "Manage workspace"}><UiIcon name="settings" size={17} /></button>
        <button type="button" onClick={() => wheelNavigation.zoomBy(0.82)} title={t(settings.locale, "zoomOut")}><UiIcon name="zoom-out" size={17} /></button>
        <button type="button" onClick={() => wheelNavigation.zoomBy(1.22)} title={t(settings.locale, "zoomIn")}><UiIcon name="zoom-in" size={17} /></button>
      </div>
      {settings.showShortcutHints && (
        <aside className="shortcut-hints" aria-label={t(settings.locale, "keyboardShortcuts")}>
          <div><kbd>{settings.shortcuts.home}</kbd><span>{t(settings.locale, "homeShortcut")}</span></div>
          <div><kbd>{settings.shortcuts.renameWindow}</kbd><span>{t(settings.locale, "renameWindow")}</span></div>
          {settings.canvasWheelCaptureMode === "key" && settings.canvasWheelOverride !== null && (
            <div>
              <kbd>{displayCanvasNavigationBinding(
                settings.canvasWheelOverride,
                window.canvasTTY.window.isMacOS
              )}</kbd>
              <span>{t(settings.locale, "canvasWheelOverrideHint")}</span>
            </div>
          )}
          {settings.canvasNavigationOverride !== null && (
            <div>
              <kbd>{displayCanvasNavigationBinding(
                settings.canvasNavigationOverride,
                window.canvasTTY.window.isMacOS
              )}</kbd>
              <span>{t(settings.locale, "canvasNavigationOverrideHint")}</span>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
