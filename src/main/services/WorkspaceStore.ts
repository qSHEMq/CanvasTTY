import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ActionRunSnapshot,
  BrowserCanvasState,
  CameraState,
  CreateSessionRequest,
  PluginCanvasInstance,
  Point,
  ProjectActionDefinition,
  ProjectActionInput,
  ProjectActionUpdate,
  SessionBounds,
  SessionMetadata,
  TerminalTemplateInput,
  TerminalTemplateUpdate,
  WorkspaceArrangeMode,
  WorkspaceCatalogSnapshot,
  WorkspaceCreateInput,
  WorkspaceDocument,
  WorkspaceGroupInput,
  WorkspaceGroupUpdate,
  WorkspacePreset,
  WorkspacePresetInput,
  WorkspaceSavedViewInput,
  WorkspaceSummary,
  WorkspaceSwitchResult,
  WorkspaceTerminal
} from "../../shared/contracts.ts";
import { DEFAULT_WORKSPACE_ID, WORKSPACE_SCHEMA_VERSION } from "../../shared/contracts.ts";
import { WorkspaceIndexStore } from "./WorkspaceIndexStore.ts";
import {
  ACTION_COUNT_MAX,
  ACTION_RUN_COUNT_MAX,
  GROUP_COUNT_MAX,
  SAVED_VIEW_COUNT_MAX,
  TEMPLATE_COUNT_MAX,
  TERMINAL_COUNT_MAX,
  createDefaultWorkspace,
  createSavedView,
  createTerminalTemplate,
  createWorkspaceGroup,
  createWorkspacePreset,
  createWorkspaceTerminal,
  isActionId,
  isRecord,
  isWorkspaceId,
  normalizeActionInput,
  normalizePoint,
  normalizeTerminalSize,
  normalizeTitle,
  normalizeWorkspace,
  objectId,
  workspaceObjectId,
  type WorkspaceMigrationSeed
} from "./workspaceNormalization.ts";

type Publish = (workspace: WorkspaceDocument) => void;

export class WorkspaceStore {
  private readonly userDataPath: string;
  private readonly index: WorkspaceIndexStore;
  private readonly publish: Publish;
  private readonly documents = new Map<string, WorkspaceDocument>();
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private activeId = DEFAULT_WORKSPACE_ID;

  constructor(userDataPath: string, index: WorkspaceIndexStore, publish: Publish = () => undefined) {
    this.userDataPath = userDataPath;
    this.index = index;
    this.publish = publish;
  }

  async load(seed: WorkspaceMigrationSeed = {}): Promise<WorkspaceSwitchResult> {
    let catalog = await this.index.load();
    if (catalog.workspaces.length === 0) {
      const migrated = await this.loadLegacy(seed);
      await this.persistDocument(migrated);
      catalog = await this.index.upsert(summary(migrated), true);
    }
    this.activeId = catalog.activeId;
    const workspace = await this.loadDocument(this.activeId, seed);
    await this.index.upsert(summary(workspace), true);
    this.publish(this.get());
    return { catalog: this.catalog(), workspace: this.get() };
  }

  catalog(): WorkspaceCatalogSnapshot {
    return this.index.get();
  }

  get(): WorkspaceDocument {
    const value = this.documents.get(this.activeId);
    if (!value) throw new Error("Active workspace has not been loaded.");
    return structuredClone(value);
  }

  getById(id: string): WorkspaceDocument | null {
    const value = this.documents.get(id);
    return value ? structuredClone(value) : null;
  }

  async switchWorkspace(id: string): Promise<WorkspaceSwitchResult> {
    if (!isWorkspaceId(id)) throw new Error("Workspace identifier is invalid.");
    const workspace = await this.loadDocument(id);
    this.activeId = id;
    const catalog = await this.index.setActive(id);
    this.publish(workspace);
    return { catalog, workspace: structuredClone(workspace) };
  }

  async createWorkspace(input: WorkspaceCreateInput): Promise<WorkspaceSwitchResult> {
    if (!isRecord(input)) throw new Error("Workspace input is invalid.");
    const now = Date.now();
    const id = `workspace-${randomUUID()}`;
    const base = createDefaultWorkspace(now, id, { projectRoot: input.projectRoot });
    const preset = input.presetId ? this.catalog().presets.find((candidate) => candidate.id === input.presetId) : null;
    const document = preset ? applyPreset(base, preset, now) : base;
    document.title = normalizeTitle(input.title, "Workspace");
    document.projectRoot = typeof input.projectRoot === "string" ? input.projectRoot.trim().slice(0, 4_096) : "";
    await this.persistDocument(document);
    this.documents.set(id, document);
    this.activeId = id;
    const catalog = await this.index.upsert(summary(document), true);
    this.publish(document);
    return { catalog, workspace: structuredClone(document) };
  }

  async duplicateWorkspace(id: string, title?: string): Promise<WorkspaceSwitchResult> {
    const source = await this.loadDocument(id);
    const now = Date.now();
    const nextId = `workspace-${randomUUID()}`;
    const document = normalizeWorkspace({
      ...source,
      id: nextId,
      revision: 0,
      title: normalizeTitle(title, `${source.title} copy`),
      terminals: [],
      actionRuns: [],
      groups: source.groups.map((group) => ({ ...group, id: objectId("group"), memberIds: [], createdAt: now, updatedAt: now })),
      savedViews: source.savedViews.map((view) => ({ ...view, id: objectId("view"), createdAt: now, updatedAt: now })),
      templates: source.templates.map((template) => ({ ...template, id: objectId("template"), createdAt: now, updatedAt: now })),
      actions: source.actions.map((action) => ({ ...action, id: objectId("action"), source: null, revision: 1, createdAt: now, updatedAt: now })),
      updatedAt: now
    }, createDefaultWorkspace(now, nextId), nextId);
    await this.persistDocument(document);
    this.documents.set(nextId, document);
    this.activeId = nextId;
    const catalog = await this.index.upsert(summary(document), true);
    this.publish(document);
    return { catalog, workspace: structuredClone(document) };
  }

  async deleteWorkspace(id: string): Promise<WorkspaceSwitchResult> {
    if (!isWorkspaceId(id)) throw new Error("Workspace identifier is invalid.");
    const catalog = await this.index.remove(id);
    this.documents.delete(id);
    await unlink(this.index.documentPath(id)).catch((error) => {
      if (!isMissingFile(error)) throw error;
    });
    this.activeId = catalog.activeId;
    const workspace = await this.loadDocument(this.activeId);
    this.publish(workspace);
    return { catalog, workspace: structuredClone(workspace) };
  }

  renameWorkspace(title: string): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => ({ ...current, title: normalizeTitle(title, current.title), updatedAt: now }));
  }

  setProjectRoot(projectRoot: string): Promise<WorkspaceDocument> {
    if (typeof projectRoot !== "string" || projectRoot.length > 4_096) return Promise.reject(new Error("Project root is invalid."));
    return this.mutateActive((current, now) => ({ ...current, projectRoot: projectRoot.trim(), updatedAt: now }));
  }

  setCamera(camera: CameraState): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => ({
      ...current,
      camera: {
        ...normalizePoint(camera, current.camera),
        zoom: Number.isFinite(camera?.zoom) ? Math.min(2, Math.max(0.2, camera.zoom)) : current.camera.zoom
      },
      updatedAt: now
    }));
  }

  terminal(id: string, workspaceId = this.activeId): WorkspaceTerminal | null {
    const terminal = this.documents.get(workspaceId)?.terminals.find((candidate) => candidate.id === id);
    return terminal ? structuredClone(terminal) : null;
  }

  action(id: string, workspaceId = this.activeId): ProjectActionDefinition | null {
    const action = this.documents.get(workspaceId)?.actions.find((candidate) => candidate.id === id);
    return action ? structuredClone(action) : null;
  }

  listActions(workspaceId = this.activeId): ProjectActionDefinition[] {
    return structuredClone(this.documents.get(workspaceId)?.actions ?? []);
  }

  listRuns(workspaceId = this.activeId): ActionRunSnapshot[] {
    return structuredClone(this.documents.get(workspaceId)?.actionRuns ?? []);
  }

  findActionTerminal(actionId: string, workspaceId = this.activeId): WorkspaceTerminal | null {
    const terminals = this.documents.get(workspaceId)?.terminals ?? [];
    for (let index = terminals.length - 1; index >= 0; index -= 1) {
      if (terminals[index]?.actionId === actionId) return structuredClone(terminals[index]!);
    }
    return null;
  }

  createTerminal(request: CreateSessionRequest, workspaceId = this.activeId): Promise<WorkspaceTerminal> {
    const terminal = createWorkspaceTerminal(request);
    return this.mutate(workspaceId, (current, now) => {
      if (current.terminals.length >= TERMINAL_COUNT_MAX) throw new Error("Workspace terminal limit reached.");
      terminal.updatedAt = now;
      return { ...current, terminals: [...current.terminals, terminal], updatedAt: now };
    }).then(() => structuredClone(terminal));
  }

  createActionTerminal(
    action: ProjectActionDefinition,
    position: Point,
    workspaceId = this.activeId,
    title = action.title,
    cwd = action.cwd
  ): Promise<WorkspaceTerminal> {
    const terminal = createWorkspaceTerminal({ provider: "terminal", profile: "normal", cwd, position, title }, Date.now(), action.id);
    return this.mutate(workspaceId, (current, now) => {
      if (current.terminals.length >= TERMINAL_COUNT_MAX) throw new Error("Workspace terminal limit reached.");
      terminal.updatedAt = now;
      return { ...current, terminals: [...current.terminals, terminal], updatedAt: now };
    }).then(() => structuredClone(terminal));
  }

  updateTerminalBounds(id: string, bounds: SessionBounds, workspaceId = this.activeId): Promise<WorkspaceDocument> {
    return this.updateTerminal(workspaceId, id, (terminal, now) => ({
      ...terminal,
      position: normalizePoint(bounds?.position, terminal.position),
      size: normalizeTerminalSize(bounds?.size, terminal.size),
      updatedAt: now
    }));
  }

  updateTerminalFromSession(session: SessionMetadata): Promise<WorkspaceDocument> {
    if (!session.workspaceObjectId) {
      const document = this.documents.get(session.workspaceId);
      return Promise.resolve(document ? structuredClone(document) : this.get());
    }
    return this.updateTerminal(session.workspaceId, session.workspaceObjectId, (terminal, now) => ({
      ...terminal,
      title: normalizeTitle(session.title, terminal.title),
      titleCustomized: session.titleCustomized,
      position: normalizePoint(session.position, terminal.position),
      size: normalizeTerminalSize(session.size, terminal.size),
      updatedAt: now
    }));
  }

  removeTerminal(id: string, workspaceId = this.activeId): Promise<WorkspaceDocument> {
    return this.mutate(workspaceId, (current, now) => ({
      ...current,
      terminals: current.terminals.filter((terminal) => terminal.id !== id),
      groups: current.groups.map((group) => ({ ...group, memberIds: group.memberIds.filter((memberId) => memberId !== id), updatedAt: now })),
      updatedAt: now
    }));
  }

  setPluginCanvas(pluginCanvas: PluginCanvasInstance[]): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => normalizeWorkspace({ ...current, pluginCanvas, updatedAt: now }, current, current.id));
  }

  setBrowserCanvas(browserCanvas: BrowserCanvasState | null): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => normalizeWorkspace({ ...current, browserCanvas, updatedAt: now }, current, current.id));
  }

  createGroup(input: WorkspaceGroupInput): Promise<WorkspaceDocument> {
    const group = createWorkspaceGroup(input);
    return this.mutateActive((current, now) => {
      if (current.groups.length >= GROUP_COUNT_MAX) throw new Error("Workspace group limit reached.");
      const objectIds = canvasObjectIds(current);
      group.memberIds = group.memberIds.filter((id) => objectIds.has(id));
      group.updatedAt = now;
      const claimed = new Set(group.memberIds);
      return {
        ...current,
        groups: [...current.groups.map((existing) => ({
          ...existing,
          memberIds: existing.memberIds.filter((id) => !claimed.has(id)),
          updatedAt: claimed.size ? now : existing.updatedAt
        })), group],
        updatedAt: now
      };
    });
  }

  updateGroup(input: WorkspaceGroupUpdate): Promise<WorkspaceDocument> {
    if (!workspaceObjectId(input.id, "group")) return Promise.reject(new Error("Workspace group identifier is invalid."));
    return this.mutateActive((current, now) => {
      const target = current.groups.find((group) => group.id === input.id);
      if (!target) throw new Error("Workspace group does not exist.");
      const next = createWorkspaceGroup({
        title: input.title ?? target.title,
        color: input.color ?? target.color,
        position: input.position ?? target.position,
        size: input.size ?? target.size,
        memberIds: input.memberIds ?? target.memberIds
      }, target.createdAt);
      next.id = target.id;
      next.collapsed = input.collapsed ?? target.collapsed;
      next.locked = input.locked ?? target.locked;
      next.memberIds = next.memberIds.filter((id) => canvasObjectIds(current).has(id));
      next.updatedAt = now;
      const claimed = new Set(next.memberIds);
      return {
        ...current,
        groups: current.groups.map((group) => group.id === input.id ? next : {
          ...group,
          memberIds: group.memberIds.filter((id) => !claimed.has(id)),
          updatedAt: claimed.size ? now : group.updatedAt
        }),
        updatedAt: now
      };
    });
  }

  moveGroup(id: string, position: Point): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => {
      const group = current.groups.find((candidate) => candidate.id === id);
      if (!group) throw new Error("Workspace group does not exist.");
      if (group.locked) return current;
      const nextPosition = normalizePoint(position, group.position);
      const delta = { x: nextPosition.x - group.position.x, y: nextPosition.y - group.position.y };
      const members = new Set(group.memberIds);
      return {
        ...current,
        groups: current.groups.map((candidate) => candidate.id === id ? { ...candidate, position: nextPosition, updatedAt: now } : candidate),
        terminals: current.terminals.map((terminal) => members.has(terminal.id) ? { ...terminal, position: offset(terminal.position, delta), updatedAt: now } : terminal),
        pluginCanvas: current.pluginCanvas.map((plugin) => members.has(plugin.id) ? { ...plugin, position: offset(plugin.position, delta) } : plugin),
        browserCanvas: current.browserCanvas && members.has("browser") ? { ...current.browserCanvas, position: offset(current.browserCanvas.position, delta) } : current.browserCanvas,
        updatedAt: now
      };
    });
  }

  removeGroup(id: string, removeMembers = false): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => {
      const group = current.groups.find((candidate) => candidate.id === id);
      if (!group) return current;
      const members = new Set(removeMembers ? group.memberIds : []);
      return {
        ...current,
        groups: current.groups.filter((candidate) => candidate.id !== id),
        terminals: current.terminals.filter((terminal) => !members.has(terminal.id)),
        pluginCanvas: current.pluginCanvas.filter((plugin) => !members.has(plugin.id)),
        browserCanvas: current.browserCanvas && members.has("browser") ? null : current.browserCanvas,
        updatedAt: now
      };
    });
  }

  autoArrange(mode: WorkspaceArrangeMode, objectIds?: string[]): Promise<WorkspaceDocument> {
    if (mode !== "grid" && mode !== "columns" && mode !== "rows") return Promise.reject(new Error("Arrange mode is invalid."));
    return this.mutateActive((current, now) => {
      const lockedMembers = new Set(current.groups.filter((group) => group.locked).flatMap((group) => group.memberIds));
      const selected = new Set((objectIds?.length ? objectIds : [...canvasObjectIds(current)]).filter((id) => !lockedMembers.has(id)));
      const objects = [
        ...current.terminals.filter((item) => selected.has(item.id)).map((item) => ({ id: item.id, size: item.size })),
        ...current.pluginCanvas.filter((item) => selected.has(item.id)).map((item) => ({ id: item.id, size: item.size })),
        ...(current.browserCanvas && selected.has("browser") ? [{ id: "browser", size: current.browserCanvas.size }] : [])
      ];
      const positions = arrangedPositions(objects, mode);
      const next: WorkspaceDocument = {
        ...current,
        terminals: current.terminals.map((terminal) => positions.has(terminal.id) ? { ...terminal, position: positions.get(terminal.id)!, updatedAt: now } : terminal),
        pluginCanvas: current.pluginCanvas.map((plugin) => positions.has(plugin.id) ? { ...plugin, position: positions.get(plugin.id)! } : plugin),
        browserCanvas: current.browserCanvas && positions.has("browser") ? { ...current.browserCanvas, position: positions.get("browser")! } : current.browserCanvas,
        updatedAt: now
      };
      next.groups = fitGroupFrames(next, now);
      return next;
    });
  }

  saveView(input: WorkspaceSavedViewInput): Promise<WorkspaceDocument> {
    const view = createSavedView(input.title, input.camera);
    return this.mutateActive((current, now) => {
      if (current.savedViews.length >= SAVED_VIEW_COUNT_MAX) throw new Error("Saved view limit reached.");
      view.updatedAt = now;
      return { ...current, savedViews: [...current.savedViews, view], updatedAt: now };
    });
  }

  removeView(id: string): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => ({ ...current, savedViews: current.savedViews.filter((view) => view.id !== id), updatedAt: now }));
  }

  createTemplate(input: TerminalTemplateInput): Promise<WorkspaceDocument> {
    const template = createTerminalTemplate(input);
    return this.mutateActive((current, now) => {
      if (current.templates.length >= TEMPLATE_COUNT_MAX) throw new Error("Terminal template limit reached.");
      template.updatedAt = now;
      return { ...current, templates: [...current.templates, template], updatedAt: now };
    });
  }

  updateTemplate(input: TerminalTemplateUpdate): Promise<WorkspaceDocument> {
    if (!workspaceObjectId(input.id, "template")) return Promise.reject(new Error("Terminal template identifier is invalid."));
    return this.mutateActive((current, now) => {
      const target = current.templates.find((template) => template.id === input.id);
      if (!target) throw new Error("Terminal template does not exist.");
      const next = createTerminalTemplate({ ...target, ...input }, target.createdAt);
      next.id = target.id;
      next.updatedAt = now;
      return { ...current, templates: current.templates.map((template) => template.id === input.id ? next : template), updatedAt: now };
    });
  }

  removeTemplate(id: string): Promise<WorkspaceDocument> {
    return this.mutateActive((current, now) => ({ ...current, templates: current.templates.filter((template) => template.id !== id), updatedAt: now }));
  }

  createAction(input: ProjectActionInput): Promise<WorkspaceDocument> {
    const now = Date.now();
    const action = normalizeActionInput(input, { id: objectId("action"), createdAt: now, updatedAt: now, revision: 1 });
    return this.mutateActive((current, mutationNow) => {
      if (current.actions.length >= ACTION_COUNT_MAX) throw new Error("Project action limit reached.");
      return { ...current, actions: [...current.actions, { ...action, updatedAt: mutationNow }], updatedAt: mutationNow };
    });
  }

  updateAction(input: ProjectActionUpdate): Promise<WorkspaceDocument> {
    if (!isActionId(input.id)) return Promise.reject(new Error("Project action identifier is invalid."));
    return this.mutateActive((current, now) => {
      let found = false;
      const actions = current.actions.map((action) => {
        if (action.id !== input.id) return action;
        found = true;
        return normalizeActionInput({ ...action, ...input }, { id: action.id, createdAt: action.createdAt, updatedAt: now, revision: action.revision + 1 });
      });
      if (!found) throw new Error("Project action does not exist.");
      return { ...current, actions, updatedAt: now };
    });
  }

  importActions(inputs: ProjectActionInput[]): Promise<WorkspaceDocument> {
    if (!Array.isArray(inputs) || inputs.length === 0) return Promise.resolve(this.get());
    return this.mutateActive((current, now) => {
      const bySource = new Map(current.actions.filter((action) => action.source).map((action) => [`${action.source!.kind}:${action.source!.path}:${action.source!.key}`, action]));
      const actions = [...current.actions];
      for (const input of inputs.slice(0, ACTION_COUNT_MAX)) {
        const sourceKey = input.source ? `${input.source.kind}:${input.source.path}:${input.source.key}` : null;
        const existing = sourceKey ? bySource.get(sourceKey) : null;
        const normalized = normalizeActionInput(input, existing
          ? { id: existing.id, createdAt: existing.createdAt, updatedAt: now, revision: existing.revision + 1 }
          : { id: objectId("action"), createdAt: now, updatedAt: now, revision: 1 });
        const index = actions.findIndex((action) => action.id === normalized.id);
        if (index >= 0) actions[index] = normalized;
        else if (actions.length < ACTION_COUNT_MAX) actions.push(normalized);
      }
      return { ...current, actions, updatedAt: now };
    });
  }

  removeAction(id: string): Promise<WorkspaceDocument> {
    if (!isActionId(id)) return Promise.reject(new Error("Project action identifier is invalid."));
    return this.mutateActive((current, now) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== id),
      terminals: current.terminals.map((terminal) => terminal.actionId === id ? { ...terminal, actionId: null, updatedAt: now } : terminal),
      actionRuns: current.actionRuns.filter((run) => run.actionId !== id),
      updatedAt: now
    }));
  }

  recordRun(run: ActionRunSnapshot): Promise<WorkspaceDocument> {
    return this.mutate(run.workspaceId, (current, now) => {
      const runs = current.actionRuns.some((candidate) => candidate.id === run.id)
        ? current.actionRuns.map((candidate) => candidate.id === run.id ? structuredClone(run) : candidate)
        : [...current.actionRuns, structuredClone(run)];
      return { ...current, actionRuns: runs.slice(-ACTION_RUN_COUNT_MAX), updatedAt: now };
    });
  }

  async savePreset(input: WorkspacePresetInput): Promise<WorkspaceCatalogSnapshot> {
    const preset = createWorkspacePreset(this.get(), input.title, input.description);
    return this.index.savePreset(preset);
  }

  removePreset(id: string): Promise<WorkspaceCatalogSnapshot> {
    return this.index.removePreset(id);
  }

  exportWorkspace(): string {
    const current = this.get();
    const sanitized = {
      format: "canvastty-workspace",
      version: WORKSPACE_SCHEMA_VERSION,
      workspace: {
        ...current,
        id: DEFAULT_WORKSPACE_ID,
        revision: 0,
        terminals: current.terminals.map((terminal) => ({ ...terminal, id: objectId("terminal"), actionId: null })),
        actionRuns: [],
        pluginCanvas: [],
        browserCanvas: null,
        updatedAt: Date.now()
      }
    };
    return JSON.stringify(sanitized, null, 2);
  }

  async importWorkspace(raw: string): Promise<WorkspaceSwitchResult> {
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024) throw new Error("Workspace import is empty or too large.");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.format !== "canvastty-workspace" || !isRecord(parsed.workspace)) throw new Error("Workspace import format is invalid.");
    const id = `workspace-${randomUUID()}`;
    const document = normalizeWorkspace({ ...parsed.workspace, id, revision: 0, actionRuns: [], updatedAt: Date.now() }, createDefaultWorkspace(Date.now(), id), id);
    await this.persistDocument(document);
    this.documents.set(id, document);
    this.activeId = id;
    const catalog = await this.index.upsert(summary(document), true);
    this.publish(document);
    return { catalog, workspace: structuredClone(document) };
  }

  private async loadLegacy(seed: WorkspaceMigrationSeed): Promise<WorkspaceDocument> {
    const legacyPath = join(this.userDataPath, "workspace.json");
    try {
      const raw = await readFile(legacyPath, "utf8");
      return normalizeWorkspace(JSON.parse(raw), createDefaultWorkspace(Date.now(), DEFAULT_WORKSPACE_ID, seed), DEFAULT_WORKSPACE_ID);
    } catch (error) {
      if (!isMissingFile(error)) console.warn("CanvasTTY legacy workspace could not be migrated; a default workspace is used.", error);
      return createDefaultWorkspace(Date.now(), DEFAULT_WORKSPACE_ID, seed);
    }
  }

  private async loadDocument(id: string, seed: WorkspaceMigrationSeed = {}): Promise<WorkspaceDocument> {
    const cached = this.documents.get(id);
    if (cached) return structuredClone(cached);
    const path = this.index.documentPath(id);
    const fallback = createDefaultWorkspace(Date.now(), id, seed);
    let document = fallback;
    try {
      const raw = await readFile(path, "utf8");
      document = normalizeWorkspace(JSON.parse(raw), fallback, id);
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(`CanvasTTY workspace ${id} could not be loaded; the corrupt file is retained.`, error);
        await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
      }
      await this.persistDocument(document);
    }
    this.documents.set(id, document);
    return structuredClone(document);
  }

  private updateTerminal(workspaceId: string, id: string, update: (terminal: WorkspaceTerminal, now: number) => WorkspaceTerminal): Promise<WorkspaceDocument> {
    return this.mutate(workspaceId, (current, now) => {
      let found = false;
      const terminals = current.terminals.map((terminal) => {
        if (terminal.id !== id) return terminal;
        found = true;
        return update(terminal, now);
      });
      if (!found) throw new Error("Workspace terminal does not exist.");
      return { ...current, terminals, updatedAt: now };
    });
  }

  private mutateActive(update: (current: WorkspaceDocument, now: number) => WorkspaceDocument): Promise<WorkspaceDocument> {
    return this.mutate(this.activeId, update);
  }

  private mutate(workspaceId: string, update: (current: WorkspaceDocument, now: number) => WorkspaceDocument): Promise<WorkspaceDocument> {
    if (!isWorkspaceId(workspaceId)) return Promise.reject(new Error("Workspace identifier is invalid."));
    const previous = this.mutationQueues.get(workspaceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const current = this.documents.get(workspaceId) ?? await this.loadDocument(workspaceId);
      const now = Date.now();
      const candidate = update(structuredClone(current), now);
      if (candidate === current) return structuredClone(current);
      const next = normalizeWorkspace({ ...candidate, schemaVersion: WORKSPACE_SCHEMA_VERSION, id: workspaceId, revision: current.revision + 1, updatedAt: now }, current, workspaceId);
      await this.persistDocument(next);
      this.documents.set(workspaceId, next);
      await this.index.upsert(summary(next), workspaceId === this.activeId);
      const snapshot = structuredClone(next);
      if (workspaceId === this.activeId) this.publish(snapshot);
      return snapshot;
    });
    this.mutationQueues.set(workspaceId, operation.then(() => undefined, () => undefined));
    return operation;
  }

  private async persistDocument(snapshot: WorkspaceDocument): Promise<void> {
    const path = this.index.documentPath(snapshot.id);
    const temporaryPath = `${path}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
    await rename(temporaryPath, path);
  }
}

function summary(document: WorkspaceDocument): WorkspaceSummary {
  return {
    id: document.id,
    title: document.title,
    projectRoot: document.projectRoot,
    objectCount: document.terminals.length + document.groups.length + document.pluginCanvas.length + (document.browserCanvas ? 1 : 0),
    updatedAt: document.updatedAt
  };
}

function canvasObjectIds(document: WorkspaceDocument): Set<string> {
  return new Set([...document.terminals.map((terminal) => terminal.id), ...document.pluginCanvas.map((plugin) => plugin.id), ...(document.browserCanvas ? ["browser"] : [])]);
}

function fitGroupFrames(document: WorkspaceDocument, now: number): WorkspaceDocument["groups"] {
  const bounds = new Map<string, { position: Point; size: { width: number; height: number } }>([
    ...document.terminals.map((terminal) => [terminal.id, { position: terminal.position, size: terminal.size }] as const),
    ...document.pluginCanvas.map((plugin) => [plugin.id, { position: plugin.position, size: plugin.size }] as const),
    ...(document.browserCanvas ? [["browser", document.browserCanvas] as const] : [])
  ]);
  return document.groups.map((group) => {
    if (group.locked) return group;
    const members = group.memberIds.flatMap((id) => bounds.get(id) ? [bounds.get(id)!] : []);
    if (members.length === 0) return group;
    const left = Math.min(...members.map((item) => item.position.x));
    const top = Math.min(...members.map((item) => item.position.y));
    const right = Math.max(...members.map((item) => item.position.x + item.size.width));
    const bottom = Math.max(...members.map((item) => item.position.y + item.size.height));
    return {
      ...group,
      position: { x: left - 28, y: top - 72 },
      size: { width: right - left + 56, height: bottom - top + 100 },
      updatedAt: now
    };
  });
}

function offset(point: Point, delta: Point): Point {
  return normalizePoint({ x: point.x + delta.x, y: point.y + delta.y }, point);
}

function arrangedPositions(objects: Array<{ id: string; size: { width: number; height: number } }>, mode: WorkspaceArrangeMode): Map<string, Point> {
  const result = new Map<string, Point>();
  if (objects.length === 0) return result;
  const gap = 40;
  const columns = mode === "columns" ? 1 : mode === "rows" ? objects.length : Math.max(1, Math.ceil(Math.sqrt(objects.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];
  objects.forEach((object, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, object.size.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, object.size.height);
  });
  const xOffsets = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + gap, 0));
  const yOffsets = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + gap, 0));
  objects.forEach((object, index) => result.set(object.id, { x: xOffsets[index % columns] ?? 0, y: yOffsets[Math.floor(index / columns)] ?? 0 }));
  return result;
}

function applyPreset(base: WorkspaceDocument, preset: WorkspacePreset, now: number): WorkspaceDocument {
  return normalizeWorkspace({
    ...base,
    groups: preset.groups.map((group) => ({ ...group, id: objectId("group"), kind: "group", memberIds: [], createdAt: now, updatedAt: now })),
    templates: preset.templates.map((template) => ({ ...template, id: objectId("template"), createdAt: now, updatedAt: now })),
    actions: preset.actions.map((action) => ({ ...action, id: objectId("action"), source: null, revision: 1, createdAt: now, updatedAt: now }))
  }, base, base.id);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
