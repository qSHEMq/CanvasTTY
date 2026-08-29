import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  ActionRunSnapshot,
  BrowserCanvasState,
  CameraState,
  PluginCanvasInstance,
  ProjectActionDefinition,
  ProjectActionInput,
  ProjectActionSource,
  ProjectActionStepDefinition,
  ProjectActionStepInput,
  ProviderId,
  Size,
  TerminalTemplate,
  TerminalTemplateInput,
  WorkspaceDocument,
  WorkspaceGroup,
  WorkspaceGroupInput,
  WorkspacePreset,
  WorkspaceSavedView,
  WorkspaceTerminal
} from "../../shared/contracts.ts";
import {
  DEFAULT_TERMINAL_SIZE,
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_SCHEMA_VERSION
} from "../../shared/contracts.ts";

export const WORKSPACE_TITLE_MAX = 80;
export const TERMINAL_TITLE_MAX = 80;
export const TERMINAL_COUNT_MAX = 256;
export const GROUP_COUNT_MAX = 64;
export const ACTION_COUNT_MAX = 128;
export const ACTION_RUN_COUNT_MAX = 50;
export const TEMPLATE_COUNT_MAX = 64;
export const SAVED_VIEW_COUNT_MAX = 32;
export const ACTION_DESCRIPTION_MAX = 240;
export const ACTION_COMMAND_MAX = 4_096;
export const ACTION_STEP_COUNT_MAX = 24;
export const MIN_TERMINAL_SIZE = { width: 420, height: 260 };
export const MAX_TERMINAL_SIZE = { width: 1_600, height: 1_100 };
export const MIN_GROUP_SIZE = { width: 460, height: 300 };
export const MAX_GROUP_SIZE = { width: 20_000, height: 20_000 };

const UUID_ID = /^[a-z][a-z0-9-]{0,31}-[a-f0-9-]{36}$/;
const SHORT_ID = /^[a-z][a-z0-9-]{0,79}$/;
const STEP_ID = /^[a-z][a-z0-9_-]{0,63}$/;

export interface WorkspaceMigrationSeed {
  projectRoot?: string;
  pluginCanvas?: PluginCanvasInstance[];
  browserCanvas?: BrowserCanvasState | null;
}

export function createDefaultWorkspace(
  now = Date.now(),
  id = DEFAULT_WORKSPACE_ID,
  seed: WorkspaceMigrationSeed = {}
): WorkspaceDocument {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    revision: 0,
    title: "Workspace",
    projectRoot: nonEmptyText(seed.projectRoot, ""),
    camera: { x: 0, y: 0, zoom: 1 },
    terminals: [],
    groups: [],
    savedViews: [],
    templates: [],
    actions: [],
    actionRuns: [],
    pluginCanvas: normalizePluginCanvas(seed.pluginCanvas, []),
    browserCanvas: normalizeBrowserCanvas(seed.browserCanvas, null),
    updatedAt: now
  };
}

export function normalizeWorkspace(
  candidate: unknown,
  fallback = createDefaultWorkspace(),
  expectedId?: string
): WorkspaceDocument {
  if (!isRecord(candidate)) return structuredClone(fallback);
  const source = candidate as Partial<WorkspaceDocument> & { schemaVersion?: number };
  const actions = normalizeActions(source.actions, fallback.actions);
  const actionIds = new Set(actions.map((action) => action.id));
  const terminals = normalizeTerminals(source.terminals, fallback.terminals, actionIds);
  const objectIds = new Set<string>([
    ...terminals.map((terminal) => terminal.id),
    ...normalizePluginCanvas(source.pluginCanvas, fallback.pluginCanvas).map((plugin) => plugin.id),
    ...(source.browserCanvas ? ["browser"] : [])
  ]);
  const pluginCanvas = normalizePluginCanvas(source.pluginCanvas, fallback.pluginCanvas);
  const browserCanvas = normalizeBrowserCanvas(source.browserCanvas, fallback.browserCanvas);
  const groups = normalizeGroups(source.groups, fallback.groups, new Set([
    ...objectIds,
    ...pluginCanvas.map((plugin) => plugin.id),
    ...(browserCanvas ? ["browser"] : [])
  ]));
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: expectedId && isWorkspaceId(expectedId)
      ? expectedId
      : isWorkspaceId(source.id) ? source.id : fallback.id,
    revision: finiteInteger(source.revision, fallback.revision, 0, Number.MAX_SAFE_INTEGER),
    title: normalizeTitle(source.title, fallback.title),
    projectRoot: pathText(source.projectRoot, fallback.projectRoot),
    camera: normalizeCamera(source.camera, fallback.camera),
    terminals,
    groups,
    savedViews: normalizeSavedViews(source.savedViews, fallback.savedViews),
    templates: normalizeTemplates(source.templates, fallback.templates),
    actions,
    actionRuns: normalizeActionRuns(source.actionRuns, actionIds),
    pluginCanvas,
    browserCanvas,
    updatedAt: finiteInteger(source.updatedAt, fallback.updatedAt, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function normalizeActionInput(
  candidate: ProjectActionInput,
  identity: Pick<ProjectActionDefinition, "id" | "createdAt" | "updatedAt"> & { revision?: number }
): ProjectActionDefinition {
  if (!isRecord(candidate)) throw new Error("Project action is invalid.");
  const title = requiredText(candidate.title, "Project action title", TERMINAL_TITLE_MAX);
  const command = requiredText(candidate.command, "Project action command", ACTION_COMMAND_MAX);
  const cwd = requiredText(candidate.cwd, "Project action folder", 4_096);
  const description = typeof candidate.description === "string"
    ? candidate.description.trim().slice(0, ACTION_DESCRIPTION_MAX)
    : "";
  if (!isRisk(candidate.risk)) throw new Error("Project action risk is invalid.");
  if (candidate.concurrency !== "focus-existing" && candidate.concurrency !== "parallel") {
    throw new Error("Project action concurrency is invalid.");
  }
  const agentPolicy = candidate.agentPolicy ?? "ask";
  if (agentPolicy !== "deny" && agentPolicy !== "ask" && agentPolicy !== "allow") {
    throw new Error("Project action agent policy is invalid.");
  }
  const autoArrange = candidate.autoArrange ?? "grid";
  if (autoArrange !== "grid" && autoArrange !== "columns" && autoArrange !== "rows") {
    throw new Error("Project action arrange mode is invalid.");
  }
  const steps = normalizeActionSteps(candidate.steps, { command, cwd, title });
  validateActionDag(steps);
  return {
    ...identity,
    title,
    description,
    command,
    cwd,
    risk: candidate.risk,
    concurrency: candidate.concurrency,
    agentPolicy,
    steps,
    autoGroup: candidate.autoGroup === true,
    autoArrange,
    source: normalizeSource(candidate.source),
    revision: Math.max(1, identity.revision ?? 1),
    pinned: candidate.pinned === true
  };
}

export function createWorkspaceTerminal(
  request: { provider: ProviderId; profile: "normal" | "yolo"; cwd: string; position: { x: number; y: number }; title?: string },
  now = Date.now(),
  actionId: string | null = null,
  size: Size = DEFAULT_TERMINAL_SIZE
): WorkspaceTerminal {
  return {
    id: objectId("terminal"),
    kind: "terminal",
    actionId,
    provider: request.provider,
    profile: request.profile,
    title: request.title?.trim().slice(0, TERMINAL_TITLE_MAX) || defaultTerminalTitle(request.provider, request.cwd),
    titleCustomized: Boolean(request.title?.trim()),
    cwd: requiredText(request.cwd, "Project folder", 4_096),
    position: normalizePoint(request.position, { x: 0, y: 0 }),
    size: normalizeSize(size, DEFAULT_TERMINAL_SIZE, MIN_TERMINAL_SIZE, MAX_TERMINAL_SIZE),
    createdAt: now,
    updatedAt: now
  };
}

export function createWorkspaceGroup(input: WorkspaceGroupInput, now = Date.now()): WorkspaceGroup {
  return {
    id: objectId("group"),
    kind: "group",
    title: requiredText(input.title, "Group title", WORKSPACE_TITLE_MAX),
    color: normalizeGroupColor(input.color),
    position: normalizePoint(input.position, { x: 0, y: 0 }),
    size: normalizeSize(input.size, { width: 1_500, height: 900 }, MIN_GROUP_SIZE, MAX_GROUP_SIZE),
    memberIds: uniqueStrings(input.memberIds, 128),
    collapsed: false,
    locked: false,
    createdAt: now,
    updatedAt: now
  };
}

export function createTerminalTemplate(input: TerminalTemplateInput, now = Date.now()): TerminalTemplate {
  if (!isProvider(input.provider)) throw new Error("Terminal template provider is invalid.");
  if (input.profile !== "normal" && input.profile !== "yolo") throw new Error("Terminal template profile is invalid.");
  return {
    id: objectId("template"),
    title: requiredText(input.title, "Terminal template title", TERMINAL_TITLE_MAX),
    provider: input.provider,
    profile: input.profile,
    cwd: requiredText(input.cwd, "Terminal template folder", 4_096),
    command: typeof input.command === "string" && input.command.trim() ? input.command.trim().slice(0, ACTION_COMMAND_MAX) : null,
    size: normalizeSize(input.size, DEFAULT_TERMINAL_SIZE, MIN_TERMINAL_SIZE, MAX_TERMINAL_SIZE),
    createdAt: now,
    updatedAt: now
  };
}

export function createSavedView(title: string, camera: CameraState, now = Date.now()): WorkspaceSavedView {
  return {
    id: objectId("view"),
    title: requiredText(title, "Saved view title", WORKSPACE_TITLE_MAX),
    camera: normalizeCamera(camera, { x: 0, y: 0, zoom: 1 }),
    createdAt: now,
    updatedAt: now
  };
}

export function createWorkspacePreset(
  document: WorkspaceDocument,
  title: string,
  description: string,
  now = Date.now()
): WorkspacePreset {
  return {
    id: objectId("preset"),
    title: requiredText(title, "Preset title", WORKSPACE_TITLE_MAX),
    description: typeof description === "string" ? description.trim().slice(0, ACTION_DESCRIPTION_MAX) : "",
    groups: document.groups.map(({ id: _id, memberIds: _members, createdAt: _created, updatedAt: _updated, ...group }) => structuredClone(group)),
    templates: document.templates.map(({ id: _id, createdAt: _created, updatedAt: _updated, ...template }) => structuredClone(template)),
    actions: document.actions.map(({ id: _id, createdAt: _created, updatedAt: _updated, source: _source, revision: _revision, ...action }) => structuredClone(action)),
    createdAt: now,
    updatedAt: now
  };
}

export function workspaceObjectId(value: unknown, prefix?: string): value is string {
  return typeof value === "string" && UUID_ID.test(value) && (!prefix || value.startsWith(`${prefix}-`));
}

export function isWorkspaceId(value: unknown): value is string {
  return value === DEFAULT_WORKSPACE_ID || (typeof value === "string" && UUID_ID.test(value) && value.startsWith("workspace-"));
}

export function isActionId(value: unknown): value is string {
  return workspaceObjectId(value, "action");
}

export function objectId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function normalizePoint(candidate: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  return isFinitePoint(candidate)
    ? { x: clamp(candidate.x, -1_000_000, 1_000_000), y: clamp(candidate.y, -1_000_000, 1_000_000) }
    : { ...fallback };
}

export function normalizeTerminalSize(candidate: unknown, fallback: Size): Size {
  return normalizeSize(candidate, fallback, MIN_TERMINAL_SIZE, MAX_TERMINAL_SIZE);
}

export function normalizeTitle(candidate: unknown, fallback: string): string {
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim().slice(0, WORKSPACE_TITLE_MAX)
    : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTerminals(candidate: unknown, fallback: readonly WorkspaceTerminal[], actionIds: ReadonlySet<string>): WorkspaceTerminal[] {
  if (!Array.isArray(candidate)) return fallback.map((terminal) => structuredClone(terminal));
  const terminals: WorkspaceTerminal[] = [];
  const ids = new Set<string>();
  for (const value of candidate.slice(0, TERMINAL_COUNT_MAX)) {
    const terminal = normalizeTerminal(value, actionIds);
    if (!terminal || ids.has(terminal.id)) continue;
    ids.add(terminal.id);
    terminals.push(terminal);
  }
  return terminals;
}

function normalizeTerminal(candidate: unknown, actionIds: ReadonlySet<string>): WorkspaceTerminal | null {
  if (!isRecord(candidate)) return null;
  const source = candidate as Partial<WorkspaceTerminal>;
  if (!workspaceObjectId(source.id, "terminal") || source.kind !== "terminal") return null;
  if (!isProvider(source.provider) || (source.profile !== "normal" && source.profile !== "yolo")) return null;
  if (typeof source.cwd !== "string" || !source.cwd || source.cwd.length > 4_096) return null;
  const createdAt = finiteInteger(source.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
  return {
    id: source.id,
    kind: "terminal",
    actionId: typeof source.actionId === "string" && actionIds.has(source.actionId) ? source.actionId : null,
    provider: source.provider,
    profile: source.profile,
    title: normalizeTitle(source.title, defaultTerminalTitle(source.provider, source.cwd)),
    titleCustomized: source.titleCustomized === true,
    cwd: source.cwd,
    position: normalizePoint(source.position, { x: 0, y: 0 }),
    size: normalizeTerminalSize(source.size, DEFAULT_TERMINAL_SIZE),
    createdAt,
    updatedAt: finiteInteger(source.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER)
  };
}

function normalizeGroups(candidate: unknown, fallback: readonly WorkspaceGroup[], objectIds: ReadonlySet<string>): WorkspaceGroup[] {
  if (!Array.isArray(candidate)) return fallback.map((group) => structuredClone(group));
  const result: WorkspaceGroup[] = [];
  const ids = new Set<string>();
  for (const value of candidate.slice(0, GROUP_COUNT_MAX)) {
    if (!isRecord(value) || !workspaceObjectId(value.id, "group") || value.kind !== "group" || ids.has(value.id)) continue;
    const createdAt = finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
    const group: WorkspaceGroup = {
      id: value.id,
      kind: "group",
      title: normalizeTitle(value.title, "Group"),
      color: normalizeGroupColor(value.color),
      position: normalizePoint(value.position, { x: 0, y: 0 }),
      size: normalizeSize(value.size, { width: 1_500, height: 900 }, MIN_GROUP_SIZE, MAX_GROUP_SIZE),
      memberIds: uniqueStrings(value.memberIds, 128).filter((id) => objectIds.has(id)),
      collapsed: value.collapsed === true,
      locked: value.locked === true,
      createdAt,
      updatedAt: finiteInteger(value.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER)
    };
    ids.add(group.id);
    result.push(group);
  }
  return result;
}

function normalizeSavedViews(candidate: unknown, fallback: readonly WorkspaceSavedView[]): WorkspaceSavedView[] {
  if (!Array.isArray(candidate)) return fallback.map((view) => structuredClone(view));
  return candidate.slice(0, SAVED_VIEW_COUNT_MAX).flatMap((value) => {
    if (!isRecord(value) || !workspaceObjectId(value.id, "view")) return [];
    const createdAt = finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
    return [{
      id: value.id,
      title: normalizeTitle(value.title, "View"),
      camera: normalizeCamera(value.camera, { x: 0, y: 0, zoom: 1 }),
      createdAt,
      updatedAt: finiteInteger(value.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER)
    }];
  });
}

function normalizeTemplates(candidate: unknown, fallback: readonly TerminalTemplate[]): TerminalTemplate[] {
  if (!Array.isArray(candidate)) return fallback.map((template) => structuredClone(template));
  return candidate.slice(0, TEMPLATE_COUNT_MAX).flatMap((value) => {
    if (!isRecord(value) || !workspaceObjectId(value.id, "template")) return [];
    try {
      const createdAt = finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
      return [{ ...createTerminalTemplate(value as unknown as TerminalTemplateInput, createdAt), id: value.id, updatedAt: finiteInteger(value.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER) }];
    } catch {
      return [];
    }
  });
}

function normalizeActions(candidate: unknown, fallback: readonly ProjectActionDefinition[]): ProjectActionDefinition[] {
  if (!Array.isArray(candidate)) return fallback.map((action) => structuredClone(action));
  const actions: ProjectActionDefinition[] = [];
  const ids = new Set<string>();
  for (const value of candidate.slice(0, ACTION_COUNT_MAX)) {
    if (!isRecord(value) || !isActionId(value.id) || ids.has(value.id)) continue;
    try {
      const createdAt = finiteInteger(value.createdAt, 0, 0, Number.MAX_SAFE_INTEGER);
      actions.push(normalizeActionInput(value as unknown as ProjectActionInput, {
        id: value.id,
        createdAt,
        updatedAt: finiteInteger(value.updatedAt, createdAt, 0, Number.MAX_SAFE_INTEGER),
        revision: finiteInteger(value.revision, 1, 1, Number.MAX_SAFE_INTEGER)
      }));
      ids.add(value.id);
    } catch {
      // Invalid persisted actions are ignored without affecting the workspace.
    }
  }
  return actions;
}

function normalizeActionSteps(candidate: unknown, fallback: { command: string; cwd: string; title: string }): ProjectActionStepDefinition[] {
  const values = Array.isArray(candidate) && candidate.length > 0
    ? candidate.slice(0, ACTION_STEP_COUNT_MAX)
    : [{ id: "main", title: fallback.title, kind: "command", command: fallback.command, cwd: fallback.cwd }];
  const result: ProjectActionStepDefinition[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!isRecord(value)) throw new Error("Project action step is invalid.");
    const step = normalizeActionStep(value as ProjectActionStepInput, fallback, index);
    if (ids.has(step.id)) throw new Error(`Duplicate project action step: ${step.id}.`);
    ids.add(step.id);
    result.push(step);
  }
  return result;
}

function normalizeActionStep(candidate: ProjectActionStepInput, fallback: { command: string; cwd: string }, index: number): ProjectActionStepDefinition {
  const kind = candidate.kind;
  if (kind !== "command" && kind !== "http-health" && kind !== "tcp-health" && kind !== "open-url") {
    throw new Error("Project action step kind is invalid.");
  }
  const rawId = typeof candidate.id === "string" ? candidate.id.trim().toLowerCase() : `step-${index + 1}`;
  const id = STEP_ID.test(rawId) ? rawId : `step-${index + 1}`;
  const execution = candidate.execution ?? "shell";
  if (execution !== "shell" && execution !== "argv") throw new Error("Project action execution mode is invalid.");
  const mode = candidate.mode ?? "task";
  if (mode !== "task" && mode !== "service") throw new Error("Project action step mode is invalid.");
  const command = kind === "command"
    ? requiredText(candidate.command ?? fallback.command, "Project action step command", ACTION_COMMAND_MAX)
    : typeof candidate.command === "string" ? candidate.command.trim().slice(0, ACTION_COMMAND_MAX) : "";
  const executable = execution === "argv" && kind === "command"
    ? requiredText(candidate.executable, "Project action executable", 1_024)
    : typeof candidate.executable === "string" ? candidate.executable.trim().slice(0, 1_024) : "";
  const args = Array.isArray(candidate.args)
    ? candidate.args.slice(0, 64).map((arg) => requiredText(arg, "Project action argument", 1_024))
    : [];
  const url = typeof candidate.url === "string" && candidate.url.trim() ? safeHttpUrl(candidate.url) : null;
  const host = typeof candidate.host === "string" && /^[a-z0-9_.:-]{1,255}$/i.test(candidate.host) ? candidate.host : null;
  const port = Number.isInteger(candidate.port) && (candidate.port as number) >= 1 && (candidate.port as number) <= 65_535
    ? candidate.port as number
    : null;
  if ((kind === "http-health" || kind === "open-url") && !url) throw new Error("Project action URL is required.");
  if (kind === "tcp-health" && (!host || !port)) throw new Error("Project action host and port are required.");
  return {
    id,
    title: requiredText(candidate.title, "Project action step title", TERMINAL_TITLE_MAX),
    kind,
    mode,
    execution,
    command,
    executable,
    args,
    cwd: pathText(candidate.cwd, fallback.cwd),
    dependsOn: uniqueStrings(candidate.dependsOn, ACTION_STEP_COUNT_MAX).filter((dependency) => STEP_ID.test(dependency)),
    timeoutMs: finiteInteger(candidate.timeoutMs, kind === "command" ? 0 : 30_000, 0, 30 * 60_000),
    url,
    host,
    port
  };
}

function validateActionDag(steps: readonly ProjectActionStepDefinition[]): void {
  const ids = new Set(steps.map((step) => step.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Project action steps contain a dependency cycle.");
    visiting.add(id);
    const step = byId.get(id)!;
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Unknown project action dependency: ${dependency}.`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id);
}

function normalizeActionRuns(candidate: unknown, actionIds: ReadonlySet<string>): ActionRunSnapshot[] {
  if (!Array.isArray(candidate)) return [];
  return candidate.slice(-ACTION_RUN_COUNT_MAX).flatMap((value) => {
    if (!isRecord(value) || !workspaceObjectId(value.id, "run") || typeof value.actionId !== "string" || !actionIds.has(value.actionId)) return [];
    const requester = value.requester === "agent" || value.requester === "plugin" ? value.requester : "user";
    const status = ["waiting-approval", "queued", "running", "ready", "succeeded", "failed", "cancelled"].includes(String(value.status))
      ? value.status as ActionRunSnapshot["status"]
      : "failed";
    return [{
      id: value.id,
      actionId: value.actionId,
      actionRevision: finiteInteger(value.actionRevision, 1, 1, Number.MAX_SAFE_INTEGER),
      workspaceId: isWorkspaceId(value.workspaceId) ? value.workspaceId : DEFAULT_WORKSPACE_ID,
      requester,
      requesterId: typeof value.requesterId === "string" ? value.requesterId.slice(0, 120) : null,
      status,
      steps: Array.isArray(value.steps) ? value.steps.slice(0, ACTION_STEP_COUNT_MAX) as ActionRunSnapshot["steps"] : [],
      startedAt: finiteInteger(value.startedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      finishedAt: Number.isSafeInteger(value.finishedAt) ? value.finishedAt as number : null,
      idempotencyKey: typeof value.idempotencyKey === "string" ? value.idempotencyKey.slice(0, 120) : null
    }];
  });
}

function normalizePluginCanvas(candidate: unknown, fallback: readonly PluginCanvasInstance[]): PluginCanvasInstance[] {
  if (!Array.isArray(candidate)) return fallback.map((item) => structuredClone(item));
  return candidate.slice(0, 128).flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.pluginId !== "string" || typeof value.contributionId !== "string") return [];
    if (!SHORT_ID.test(value.pluginId) || !SHORT_ID.test(value.contributionId)) return [];
    return [{
      id: value.id.slice(0, 160),
      pluginId: value.pluginId,
      contributionId: value.contributionId,
      title: normalizeTitle(value.title, value.contributionId),
      position: normalizePoint(value.position, { x: 0, y: 0 }),
      size: normalizeSize(value.size, { width: 700, height: 500 }, { width: 320, height: 220 }, MAX_TERMINAL_SIZE)
    }];
  });
}

function normalizeBrowserCanvas(candidate: unknown, fallback: BrowserCanvasState | null): BrowserCanvasState | null {
  if (candidate === null) return null;
  if (!isRecord(candidate)) return fallback ? structuredClone(fallback) : null;
  return {
    position: normalizePoint(candidate.position, fallback?.position ?? { x: 0, y: 0 }),
    size: normalizeSize(candidate.size, fallback?.size ?? { width: 900, height: 640 }, { width: 520, height: 360 }, MAX_TERMINAL_SIZE)
  };
}

function normalizeSource(candidate: unknown): ProjectActionSource | null {
  if (candidate === null || candidate === undefined) return null;
  if (!isRecord(candidate)) throw new Error("Project action source is invalid.");
  const kinds = new Set(["manual", "package-json", "just", "make", "taskfile", "docker-compose", "script"]);
  if (!kinds.has(String(candidate.kind))) throw new Error("Project action source kind is invalid.");
  return {
    kind: candidate.kind as ProjectActionSource["kind"],
    path: requiredText(candidate.path, "Project action source path", 4_096),
    key: requiredText(candidate.key, "Project action source key", 240)
  };
}

function normalizeCamera(candidate: unknown, fallback: CameraState): CameraState {
  if (!isRecord(candidate)) return { ...fallback };
  const point = normalizePoint(candidate, fallback);
  return { ...point, zoom: Number.isFinite(candidate.zoom) ? clamp(Number(candidate.zoom), 0.2, 2) : fallback.zoom };
}

function normalizeSize(candidate: unknown, fallback: Size, minimum: Size, maximum: Size): Size {
  return isFiniteSize(candidate)
    ? { width: clamp(candidate.width, minimum.width, maximum.width), height: clamp(candidate.height, minimum.height, maximum.height) }
    : { ...fallback };
}

function normalizeGroupColor(value: unknown): WorkspaceGroup["color"] {
  return value === "lilac" || value === "blue" || value === "sand" || value === "rose" || value === "slate" ? value : "sage";
}

function defaultTerminalTitle(provider: ProviderId, cwd: string): string {
  const project = basename(cwd) || cwd;
  if (provider === "terminal") return `Terminal · ${project}`.slice(0, TERMINAL_TITLE_MAX);
  if (provider === "opencode") return `${project} · OpenCode`.slice(0, TERMINAL_TITLE_MAX);
  if (provider === "hermes") return `${project} · Hermes`.slice(0, TERMINAL_TITLE_MAX);
  if (provider === "qwen") return `${project} · Qwen Code`.slice(0, TERMINAL_TITLE_MAX);
  if (provider === "grok") return `${project} · Grok Build`.slice(0, TERMINAL_TITLE_MAX);
  return `${project} · ${provider[0].toUpperCase()}${provider.slice(1)}`.slice(0, TERMINAL_TITLE_MAX);
}

function requiredText(candidate: unknown, label: string, maxLength: number): string {
  if (typeof candidate !== "string" || candidate.trim().length === 0) throw new Error(`${label} is required.`);
  if (candidate.length > maxLength) throw new Error(`${label} is too long.`);
  return candidate.trim();
}

function nonEmptyText(candidate: unknown, fallback: string): string {
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 4_096) : fallback;
}

function pathText(candidate: unknown, fallback: string): string {
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 4_096) : fallback;
}

function uniqueStrings(candidate: unknown, max: number): string[] {
  if (!Array.isArray(candidate)) return [];
  return [...new Set(candidate.filter((value): value is string => typeof value === "string" && value.length <= 160))].slice(0, max);
}

function isRisk(value: unknown): value is ProjectActionDefinition["risk"] {
  return value === "safe" || value === "write" || value === "dangerous";
}

function isProvider(value: unknown): value is ProviderId {
  return value === "terminal" || value === "codex" || value === "claude" || value === "qwen"
    || value === "kimi" || value === "opencode" || value === "hermes" || value === "grok";
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  return Boolean(isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y));
}

function isFiniteSize(value: unknown): value is Size {
  return Boolean(isRecord(value) && Number.isFinite(value.width) && Number.isFinite(value.height));
}

function finiteInteger(candidate: unknown, fallback: number, min: number, max: number): number {
  return Number.isSafeInteger(candidate) ? clamp(candidate as number, min, max) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Project action URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Project action URL must use HTTP(S).");
  return url.toString();
}
