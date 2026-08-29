import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, extname, isAbsolute, join } from "node:path";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type {
  CreateSessionRequest,
  Point,
  ProjectActionDefinition,
  ProjectActionStepDefinition,
  ProviderId,
  SessionBounds,
  SessionEvent,
  SessionMetadata,
  SessionRemovedEvent,
  SessionSnapshot,
  TerminalDataEvent
} from "../../shared/contracts.ts";
import { DEFAULT_TERMINAL_SIZE, IPC } from "../../shared/contracts.ts";
import type {
  AgentBrowserLaunchCoordinator,
  PreparedAgentBrowserPtyLaunch
} from "./agent-browser/AgentBrowserBridge.ts";
import { AGENT_BROWSER_ENV } from "./agent-browser/AgentBrowserBridge.ts";
import type {
  AgentRuntimeLaunchCoordinator,
  PreparedAgentRuntimePtyLaunch
} from "./agent-runtime/AgentRuntimeBridge.ts";
import { AGENT_RUNTIME_ENV } from "../../agent-runtime/runtime-protocol.mjs";
import { mergeOpenCodeLaunchEnvironment } from "./agent-runtime/ProviderRuntimeLaunch.ts";
import { tryPtyOperation } from "./ptySafety.ts";
import { terminalFailureDetails } from "./terminalFailureDetails.ts";
import { resolveTerminalLaunch } from "./terminalLaunch.ts";
import type { ProviderCliRegistry, UnavailableProviderCli } from "./providerCliRegistry.ts";
import {
  createProviderLifecycleParser,
  initialSessionStatus,
  type ProviderLifecycleParser
} from "./providerLifecycle.ts";

const MAX_SCROLLBACK_CHARS = 240_000;
const OUTPUT_BATCH_MS = 16;
const MIN_TERMINAL_SIZE = { width: 420, height: 260 };
const MAX_TERMINAL_SIZE = { width: 1_600, height: 1_100 };

interface ManagedSession {
  metadata: SessionMetadata;
  process: IPty | null;
  bufferChunks: string[];
  bufferStart: number;
  bufferLength: number;
  pendingOutput: string[];
  outputTimer: ReturnType<typeof setTimeout> | null;
  agentBrowser: PreparedAgentBrowserPtyLaunch | null;
  agentRuntime: PreparedAgentRuntimePtyLaunch | null;
  lifecycle: ProviderLifecycleParser | null;
  launch: ManagedSessionLaunch;
}

type ManagedSessionLaunch =
  | {
    kind: "interactive";
    provider: ProviderId;
    profile: CreateSessionRequest["profile"];
    cwd: string;
  }
  | {
    kind: "action";
    actionId: string;
    runId: string;
    step: ProjectActionStepDefinition;
  };

export interface TerminalCreationContext {
  workspaceId?: string;
  workspaceObjectId?: string;
  size?: { width: number; height: number };
  titleCustomized?: boolean;
}

export interface ActionTerminalCreationContext {
  workspaceId: string;
  workspaceObjectId: string;
  runId: string;
  stepId: string;
  position: Point;
  size?: { width: number; height: number };
}

export interface ProviderLifecycleSignal {
  kind: "lifecycle";
  state: "idle" | "working" | "needs_approval";
  requestId?: string;
}

type Emit = (
  channel: typeof IPC.terminalData | typeof IPC.terminalSession | typeof IPC.terminalRemoved,
  payload: TerminalDataEvent | SessionEvent | SessionRemovedEvent
) => void;

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionListeners = new Set<(session: SessionMetadata) => void>();
  private readonly emit: Emit;
  private readonly providerClis: ProviderCliRegistry;
  private readonly agentBrowser?: AgentBrowserLaunchCoordinator;
  private readonly agentRuntime?: AgentRuntimeLaunchCoordinator;

  constructor(
    emit: Emit,
    providerClis: ProviderCliRegistry,
    agentBrowser?: AgentBrowserLaunchCoordinator,
    agentRuntime?: AgentRuntimeLaunchCoordinator
  ) {
    this.emit = emit;
    this.providerClis = providerClis;
    this.agentBrowser = agentBrowser;
    this.agentRuntime = agentRuntime;
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => snapshot(session));
  }

  create(request: CreateSessionRequest, context: TerminalCreationContext = {}): SessionSnapshot {
    assertCreateRequest(request);
    assertDirectory(request.cwd);

    const id = randomUUID();
    const metadata: SessionMetadata = {
      id,
      revision: 0,
      workspaceId: context.workspaceId ?? "default",
      workspaceObjectId: context.workspaceObjectId ?? null,
      actionId: null,
      actionRunId: null,
      actionStepId: null,
      provider: request.provider,
      profile: request.profile,
      title: request.title?.trim() || defaultTitle(request.provider, request.cwd),
      titleCustomized: context.titleCustomized ?? Boolean(request.title?.trim()),
      cwd: request.cwd,
      position: request.position,
      size: context.size ? {
        width: clamp(context.size.width, MIN_TERMINAL_SIZE.width, MAX_TERMINAL_SIZE.width),
        height: clamp(context.size.height, MIN_TERMINAL_SIZE.height, MAX_TERMINAL_SIZE.height)
      } : { ...DEFAULT_TERMINAL_SIZE },
      status: initialSessionStatus(request.provider),
      startedAt: Date.now(),
      exitCode: null,
      failureDetails: null
    };
    const launched = this.spawnProcess(id, request.provider, request.profile, request.cwd);
    if (launched.failure) applyLaunchFailure(metadata, launched.failure);

    const session: ManagedSession = {
      metadata,
      process: launched.process,
      bufferChunks: [],
      bufferStart: 0,
      bufferLength: 0,
      pendingOutput: [],
      outputTimer: null,
      agentBrowser: launched.agentBrowser,
      agentRuntime: launched.agentRuntime,
      lifecycle: createProviderLifecycleParser(request.provider, request.cwd),
      launch: {
        kind: "interactive",
        provider: request.provider,
        profile: request.profile,
        cwd: request.cwd
      }
    };
    this.sessions.set(id, session);
    if (launched.process) this.bindProcess(id, session, launched.process);
    const runtimeStatus = this.agentRuntime?.currentStatus(id);
    if (runtimeStatus) session.metadata.status = runtimeStatus;

    this.emitSession(metadata);
    return snapshot(session);
  }

  createAction(
    action: ProjectActionDefinition,
    context: ActionTerminalCreationContext
  ): SessionSnapshot {
    const step = action.steps[0];
    if (!step || step.kind !== "command") throw new Error("Project action has no command step.");
    return this.createActionStep(action, step, context);
  }

  createActionStep(
    action: ProjectActionDefinition,
    step: ProjectActionStepDefinition,
    context: ActionTerminalCreationContext
  ): SessionSnapshot {
    assertDirectory(step.cwd);
    const id = randomUUID();
    const metadata: SessionMetadata = {
      id,
      revision: 0,
      workspaceId: context.workspaceId,
      workspaceObjectId: context.workspaceObjectId,
      actionId: action.id,
      actionRunId: context.runId,
      actionStepId: context.stepId,
      provider: "terminal",
      profile: "normal",
      title: step.title,
      titleCustomized: true,
      cwd: step.cwd,
      position: context.position,
      size: context.size ? {
        width: clamp(context.size.width, MIN_TERMINAL_SIZE.width, MAX_TERMINAL_SIZE.width),
        height: clamp(context.size.height, MIN_TERMINAL_SIZE.height, MAX_TERMINAL_SIZE.height)
      } : { ...DEFAULT_TERMINAL_SIZE },
      status: "working",
      startedAt: Date.now(),
      exitCode: null,
      failureDetails: null
    };
    const launched = this.spawnActionProcess(step);
    if (!launched.process) applyActionLaunchFailure(metadata, launched.failure);
    const session: ManagedSession = {
      metadata,
      process: launched.process,
      bufferChunks: [],
      bufferStart: 0,
      bufferLength: 0,
      pendingOutput: [],
      outputTimer: null,
      agentBrowser: null,
      agentRuntime: null,
      lifecycle: null,
      launch: { kind: "action", actionId: action.id, runId: context.runId, step: structuredClone(step) }
    };
    this.sessions.set(id, session);
    if (launched.process) this.bindProcess(id, session, launched.process);
    this.emitSession(metadata);
    return snapshot(session);
  }

  findByWorkspaceObject(objectId: string, workspaceId?: string): SessionSnapshot | null {
    for (const session of this.sessions.values()) {
      if (session.metadata.workspaceObjectId === objectId && (!workspaceId || session.metadata.workspaceId === workspaceId)) return snapshot(session);
    }
    return null;
  }

  findLatestByAction(actionId: string, workspaceId?: string): SessionSnapshot | null {
    const matches = [...this.sessions.values()]
      .filter((session) => session.metadata.actionId === actionId && (!workspaceId || session.metadata.workspaceId === workspaceId))
      .sort((left, right) => right.metadata.startedAt - left.metadata.startedAt);
    return matches[0] ? snapshot(matches[0]) : null;
  }

  findByRun(runId: string): SessionSnapshot[] {
    return [...this.sessions.values()]
      .filter((session) => session.metadata.actionRunId === runId)
      .map((session) => snapshot(session));
  }

  onSession(listener: (session: SessionMetadata) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  metadata(id: string): SessionMetadata | null {
    const session = this.sessions.get(id);
    return session ? structuredClone(session.metadata) : null;
  }

  restart(id: string): SessionSnapshot {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Terminal session does not exist.");
    if (session.metadata.exitCode === null) throw new Error("Terminal session is still running.");

    if (session.launch.kind === "action") {
      return this.restartActionWithLaunch(id, session, session.launch);
    }
    const launched = this.spawnProcess(id, session.launch.provider, session.launch.profile, session.launch.cwd);
    session.process = launched.process;
    session.agentBrowser = launched.agentBrowser;
    session.agentRuntime = launched.agentRuntime;
    session.lifecycle = createProviderLifecycleParser(session.metadata.provider, session.metadata.cwd);
    session.metadata.startedAt = Date.now();
    if (launched.failure) {
      applyLaunchFailure(session.metadata, launched.failure);
    } else {
      session.metadata.status = initialSessionStatus(session.metadata.provider);
      session.metadata.exitCode = null;
      session.metadata.failureDetails = null;
      if (launched.process) this.bindProcess(id, session, launched.process);
      const runtimeStatus = this.agentRuntime?.currentStatus(id);
      if (runtimeStatus) session.metadata.status = runtimeStatus;
    }
    this.emitSession(session.metadata);
    return snapshot(session);
  }

  restartAction(id: string, action: ProjectActionDefinition): SessionSnapshot {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Terminal session does not exist.");
    if (session.metadata.exitCode === null) return snapshot(session);
    const step = action.steps.find((candidate) => candidate.kind === "command");
    if (!step) throw new Error("Project action has no command step.");
    assertDirectory(step.cwd);
    return this.restartActionWithLaunch(id, session, {
      kind: "action",
      actionId: action.id,
      runId: session.metadata.actionRunId ?? `run-${randomUUID()}`,
      step: structuredClone(step)
    }, step.title);
  }

  input(id: string, data: string): void {
    if (typeof data !== "string" || data.length === 0) return;
    const session = this.sessions.get(id);
    if (!session || session.metadata.exitCode !== null || !session.process) return;
    const process = session.process;
    tryPtyOperation(() => process.write(data));
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    const session = this.sessions.get(id);
    if (!session || session.metadata.exitCode !== null || !session.process) return;
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
    const process = session.process;
    tryPtyOperation(() => process.resize(safeCols, safeRows));
  }

  setBounds(id: string, bounds: SessionBounds): void {
    if (!isSessionBounds(bounds)) return;
    const session = this.sessions.get(id);
    if (!session) return;

    session.metadata.position = bounds.position;
    session.metadata.size = {
      width: clamp(bounds.size.width, MIN_TERMINAL_SIZE.width, MAX_TERMINAL_SIZE.width),
      height: clamp(bounds.size.height, MIN_TERMINAL_SIZE.height, MAX_TERMINAL_SIZE.height)
    };
    this.emitSession(session.metadata);
  }

  rename(id: string, title: string): SessionMetadata {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Terminal session does not exist.");
    if (typeof title !== "string") throw new Error("Window title is invalid.");

    const nextTitle = title.trim();
    if (nextTitle.length === 0) throw new Error("Window title cannot be empty.");
    session.metadata.title = nextTitle.slice(0, 80);
    session.metadata.titleCustomized = true;
    this.emitSession(session.metadata);
    return structuredClone(session.metadata);
  }

  applyProviderSignal(id: string, signal: ProviderLifecycleSignal): void {
    const session = this.sessions.get(id);
    if (!session || session.metadata.status === "done" || session.metadata.status === "failed") return;

    const nextStatus = signal.state;
    if (session.metadata.status === nextStatus) return;
    session.metadata.status = nextStatus;
    this.emitSession(session.metadata);
  }

  dispose(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    this.flushOutput(id, session);
    this.sessions.delete(id);
    session.agentBrowser?.cleanup();
    session.agentRuntime?.cleanup();
    if (session.process) {
      try {
        session.process.kill();
      } catch (error) {
        console.warn(`PTY ${id} could not be killed cleanly.`, error);
      }
    }
    this.emit(IPC.terminalRemoved, { id });
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.dispose(id);
    }
  }

  private emitSession(metadata: SessionMetadata): void {
    metadata.revision += 1;
    const event = structuredClone(metadata);
    for (const listener of this.sessionListeners) listener(event);
    this.emit(IPC.terminalSession, { session: event });
  }

  private spawnProcess(
    id: string,
    provider: ProviderId,
    profile: CreateSessionRequest["profile"],
    cwd: string
  ): {
    process: IPty | null;
    agentBrowser: PreparedAgentBrowserPtyLaunch | null;
    agentRuntime: PreparedAgentRuntimePtyLaunch | null;
    failure: UnavailableProviderCli | null;
  } {
    const providerCli = provider === "terminal" ? undefined : this.providerClis.get(provider);
    if (providerCli?.state === "unavailable") {
      return { process: null, agentBrowser: null, agentRuntime: null, failure: providerCli };
    }
    const agentRuntime = provider === "terminal"
      ? null
      : this.agentRuntime?.prepareLaunch({ terminalSessionId: id, provider, cwd }) ?? null;
    let agentBrowser: PreparedAgentBrowserPtyLaunch | null = null;
    try {
      agentBrowser = provider === "terminal" || provider === "grok"
        ? null
        : this.agentBrowser?.prepareLaunch({ terminalSessionId: id, provider, cwd }) ?? null;
      const baseEnvironment = terminalEnvironment();
      const browserEnvironment = agentBrowser?.environment ?? {};
      const runtimeEnvironment = agentRuntime?.environment ?? {};
      const providerEnvironment = provider === "opencode"
        ? mergeOpenCodeLaunchEnvironment(browserEnvironment, runtimeEnvironment)
        : { ...browserEnvironment, ...runtimeEnvironment };
      const providerArgs = [...(agentRuntime?.args ?? []), ...(agentBrowser?.args ?? [])];
      const launch = resolveTerminalLaunch(provider, profile, providerArgs, {
        environment: { ...baseEnvironment, ...providerEnvironment },
        ...(providerCli ? { providerCli } : {})
      });
      return {
        process: pty.spawn(launch.command, launch.args, {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd,
          env: { ...baseEnvironment, ...providerEnvironment, ...launch.environment }
        }),
        agentBrowser,
        agentRuntime,
        failure: null
      };
    } catch (error) {
      agentBrowser?.cleanup();
      agentRuntime?.cleanup();
      throw error;
    }
  }

  private spawnActionProcess(step: ProjectActionStepDefinition): { process: IPty | null; failure: string | null } {
    try {
      const launch = step.execution === "argv"
        ? actionArgvLaunch(step.executable, step.args)
        : actionShellLaunch(step.command);
      return {
        process: pty.spawn(launch.command, launch.args, {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: step.cwd,
          env: terminalEnvironment()
        }),
        failure: null
      };
    } catch (error) {
      return {
        process: null,
        failure: error instanceof Error ? error.message : "Project action could not be launched."
      };
    }
  }

  private restartActionWithLaunch(
    id: string,
    session: ManagedSession,
    launch: Extract<ManagedSessionLaunch, { kind: "action" }>,
    title = session.metadata.title
  ): SessionSnapshot {
    const launched = this.spawnActionProcess(launch.step);
    session.process = launched.process;
    session.agentBrowser = null;
    session.agentRuntime = null;
    session.lifecycle = null;
    session.launch = launch;
    session.metadata.actionId = launch.actionId;
    session.metadata.actionRunId = launch.runId;
    session.metadata.actionStepId = launch.step.id;
    session.metadata.title = title;
    session.metadata.titleCustomized = true;
    session.metadata.cwd = launch.step.cwd;
    session.metadata.startedAt = Date.now();
    if (!launched.process) {
      applyActionLaunchFailure(session.metadata, launched.failure);
    } else {
      session.metadata.status = "working";
      session.metadata.exitCode = null;
      session.metadata.failureDetails = null;
      this.bindProcess(id, session, launched.process);
    }
    this.emitSession(session.metadata);
    return snapshot(session);
  }

  private bindProcess(id: string, session: ManagedSession, process: IPty): void {
    process.onData((data) => {
      const current = this.sessions.get(id);
      if (!current || current !== session || current.process !== process) return;

      const lifecycleState = current.lifecycle?.push(data);
      if (lifecycleState) this.applyProviderSignal(id, { kind: "lifecycle", state: lifecycleState });
      appendScrollback(current, data);
      this.queueOutput(id, current, data);
    });

    process.onExit(({ exitCode }) => {
      const current = this.sessions.get(id);
      if (!current || current !== session || current.process !== process) return;

      this.flushOutput(id, current);
      current.metadata.exitCode = exitCode;
      current.metadata.status = exitCode === 0 ? "done" : "failed";
      current.metadata.failureDetails = exitCode === 0
        ? null
        : terminalFailureDetails(current.bufferChunks.slice(current.bufferStart).join(""));
      current.agentBrowser?.cleanup();
      current.agentBrowser = null;
      current.agentRuntime?.cleanup();
      current.agentRuntime = null;
      this.emitSession(current.metadata);
    });
  }

  private queueOutput(id: string, session: ManagedSession, data: string): void {
    session.pendingOutput.push(data);
    if (session.outputTimer !== null) return;
    // Keep a TUI's clear-and-redraw sequence in one renderer update whenever possible.
    session.outputTimer = setTimeout(() => this.flushOutput(id, session), OUTPUT_BATCH_MS);
  }

  private flushOutput(id: string, session: ManagedSession): void {
    if (session.outputTimer !== null) {
      clearTimeout(session.outputTimer);
      session.outputTimer = null;
    }
    if (session.pendingOutput.length === 0) return;

    const data = session.pendingOutput.join("");
    session.pendingOutput.length = 0;
    this.emit(IPC.terminalData, { id, data });
  }
}

function applyLaunchFailure(metadata: SessionMetadata, failure: UnavailableProviderCli): void {
  metadata.status = "failed";
  metadata.exitCode = 127;
  metadata.failureDetails = failure.diagnostic;
}

function applyActionLaunchFailure(metadata: SessionMetadata, failure: string | null): void {
  metadata.status = "failed";
  metadata.exitCode = 127;
  metadata.failureDetails = failure || "Project action could not be launched.";
}

export function actionShellLaunch(
  command: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("Project action command is required.");
  }
  const shell = resolveTerminalLaunch("terminal", "normal", [], { platform });
  if (platform !== "win32") return { command: shell.command, args: ["-lc", command] };
  const executable = basename(shell.command).toLowerCase();
  if (executable === "powershell.exe" || executable === "pwsh.exe" || executable === "pwsh") {
    const shellArgs = Array.isArray(shell.args) ? shell.args : [];
    return { command: shell.command, args: [...shellArgs, "-Command", command] };
  }
  return { command: shell.command, args: ["/d", "/s", "/c", command] };
}

export function actionArgvLaunch(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env
): { command: string; args: string[] } {
  if (typeof executable !== "string" || executable.trim().length === 0 || executable.includes("\0")) {
    throw new Error("Project action executable is required.");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Project action arguments are invalid.");
  }
  const resolved = resolveActionExecutable(executable.trim(), platform, environment);
  const extension = extname(resolved).toLowerCase();
  if (platform === "win32" && (extension === ".cmd" || extension === ".bat")) {
    const shell = resolveTerminalLaunch("terminal", "normal", [], { platform });
    return { command: shell.command, args: ["/d", "/s", "/c", resolved, ...args] };
  }
  return { command: resolved, args: [...args] };
}

function resolveActionExecutable(
  executable: string,
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>
): string {
  const extensions = platform === "win32"
    ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const candidates = isAbsolute(executable) || executable.includes("/") || executable.includes("\\")
    ? [executable]
    : (environment.PATH ?? "").split(delimiter).filter(Boolean).flatMap((directory) => (
      extname(executable) ? [join(directory, executable)] : extensions.map((extension) => join(directory, `${executable}${extension.toLowerCase()}`))
    ));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      if (platform !== "win32") accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH candidates.
    }
  }
  throw new Error(`Project action executable is unavailable: ${executable}`);
}

export function terminalEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const reserved = new Set<string>([
    ...Object.values(AGENT_BROWSER_ENV),
    ...Object.values(AGENT_RUNTIME_ENV)
  ]);
  const environment = Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string" && !reserved.has(entry[0])
    ))
  );
  return { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

function defaultTitle(provider: ProviderId, cwd: string): string {
  const project = basename(cwd) || cwd;
  if (provider === "terminal") return `Terminal · ${project}`;
  if (provider === "opencode") return `${project} · OpenCode`;
  if (provider === "hermes") return `${project} · Hermes`;
  if (provider === "qwen") return `${project} · Qwen Code`;
  if (provider === "grok") return `${project} · Grok Build`;
  return `${project} · ${provider[0].toUpperCase()}${provider.slice(1)}`;
}

function assertDirectory(cwd: string): void {
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new Error(`Project folder does not exist: ${cwd}`);
  }
}

function assertCreateRequest(request: CreateSessionRequest): void {
  const providers = new Set<ProviderId>(["terminal", "codex", "claude", "qwen", "kimi", "opencode", "hermes", "grok"]);
  if (!request || !providers.has(request.provider)) throw new Error("Unknown terminal provider.");
  if (request.profile !== "normal" && request.profile !== "yolo") throw new Error("Unknown launch profile.");
  if (typeof request.cwd !== "string" || request.cwd.length === 0) throw new Error("Project folder is required.");
  if (!isPoint(request.position)) throw new Error("Session position is invalid.");
}

function isPoint(value: unknown): value is Point {
  return Boolean(
    value
    && typeof value === "object"
    && "x" in value
    && "y" in value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
  );
}

function isSessionBounds(value: unknown): value is SessionBounds {
  if (!value || typeof value !== "object" || !("position" in value) || !("size" in value)) return false;
  const size = value.size;
  return isPoint(value.position)
    && Boolean(
      size
      && typeof size === "object"
      && "width" in size
      && "height" in size
      && Number.isFinite(size.width)
      && Number.isFinite(size.height)
    );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapshot(session: ManagedSession): SessionSnapshot {
  return {
    ...structuredClone(session.metadata),
    buffer: session.bufferChunks.slice(session.bufferStart).join("")
  };
}

function appendScrollback(session: ManagedSession, data: string): void {
  session.bufferChunks.push(data);
  session.bufferLength += data.length;

  while (session.bufferLength > MAX_SCROLLBACK_CHARS) {
    const first = session.bufferChunks[session.bufferStart];
    if (first === undefined) {
      session.bufferChunks.length = 0;
      session.bufferStart = 0;
      session.bufferLength = 0;
      return;
    }
    const overflow = session.bufferLength - MAX_SCROLLBACK_CHARS;
    if (first.length <= overflow) {
      session.bufferStart += 1;
      session.bufferLength -= first.length;
      continue;
    }
    session.bufferChunks[session.bufferStart] = first.slice(overflow);
    session.bufferLength -= overflow;
  }

  if (session.bufferStart > 256 && session.bufferStart * 2 >= session.bufferChunks.length) {
    session.bufferChunks = session.bufferChunks.slice(session.bufferStart);
    session.bufferStart = 0;
  }
}
