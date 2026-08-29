import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type {
  ActionApprovalRequest,
  ActionRunEvent,
  ActionRunSnapshot,
  ActionStepRunSnapshot,
  Point,
  ProjectActionDefinition,
  ProjectActionStepDefinition,
  RunProjectActionRequest,
  RunProjectActionResult,
  SessionMetadata,
  SessionSnapshot,
  WorkspaceGroupInput
} from "../../shared/contracts.ts";
import type { TerminalManager } from "./TerminalManager.ts";
import type { WorkspaceStore } from "./WorkspaceStore.ts";

const APPROVAL_TTL_MS = 5 * 60_000;
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const HEALTH_POLL_MS = 500;

type PublishRun = (event: ActionRunEvent) => void;
type PublishApproval = (approval: ActionApprovalRequest) => void;
type OpenUrl = (url: string) => Promise<void>;

interface RunState {
  snapshot: ActionRunSnapshot;
  action: ProjectActionDefinition;
  origin: Point;
  controllers: Map<string, AbortController>;
  groupCreated: boolean;
  requestedTerminalObjectId: string | null;
}

interface ApprovalState {
  request: ActionApprovalRequest;
  runRequest: RunProjectActionRequest;
  waitingRunId: string;
}

export class ActionRunManager {
  private readonly workspace: WorkspaceStore;
  private readonly terminals: TerminalManager;
  private readonly publishRun: PublishRun;
  private readonly publishApproval: PublishApproval;
  private readonly openUrl: OpenUrl;
  private readonly runs = new Map<string, RunState>();
  private readonly approvals = new Map<string, ApprovalState>();
  private readonly idempotency = new Map<string, { runId: string; expiresAt: number }>();
  private readonly unsubscribeTerminal: () => void;

  constructor(
    workspace: WorkspaceStore,
    terminals: TerminalManager,
    publishRun: PublishRun = () => undefined,
    publishApproval: PublishApproval = () => undefined,
    openUrl: OpenUrl = async () => undefined
  ) {
    this.workspace = workspace;
    this.terminals = terminals;
    this.publishRun = publishRun;
    this.publishApproval = publishApproval;
    this.openUrl = openUrl;
    this.unsubscribeTerminal = terminals.onSession((session) => this.onTerminalSession(session));
  }

  dispose(): void {
    this.unsubscribeTerminal();
    for (const state of this.runs.values()) for (const controller of state.controllers.values()) controller.abort();
    this.runs.clear();
    this.approvals.clear();
  }

  list(workspaceId = this.workspace.get().id): ActionRunSnapshot[] {
    const live = [...this.runs.values()].filter((state) => state.snapshot.workspaceId === workspaceId).map((state) => state.snapshot);
    const persisted = this.workspace.listRuns(workspaceId);
    const byId = new Map(persisted.map((run) => [run.id, run]));
    for (const run of live) byId.set(run.id, run);
    return [...byId.values()].sort((left, right) => right.startedAt - left.startedAt).map((run) => structuredClone(run));
  }

  status(runId: string): ActionRunSnapshot | null {
    const live = this.runs.get(runId)?.snapshot;
    if (live) return structuredClone(live);
    const persisted = this.workspace.listRuns().find((run) => run.id === runId);
    return persisted ? structuredClone(persisted) : null;
  }

  async run(request: RunProjectActionRequest): Promise<RunProjectActionResult> {
    this.cleanupExpired();
    const workspace = this.workspace.get();
    const action = this.workspace.action(request.id, workspace.id);
    if (!action) throw new Error("Project action does not exist.");
    const requester = request.requester ?? "user";
    const requesterId = request.requesterId?.trim().slice(0, 120) || null;
    if (requester !== "user" && !requesterId) throw new Error("External action requester identity is required.");
    if (requester !== "user" && action.agentPolicy === "deny") throw new Error("This project action is not available to agents or plugins.");

    const idempotencyKey = request.idempotencyKey?.trim().slice(0, 120) || null;
    if (idempotencyKey && !request.approvalToken) {
      const existing = this.idempotency.get(`${workspace.id}:${requester}:${requesterId ?? "user"}:${idempotencyKey}`);
      const state = existing ? this.runs.get(existing.runId) : null;
      if (state) return state.snapshot.status === "waiting-approval"
        ? { run: structuredClone(state.snapshot), session: null, focusedExisting: true, needsApproval: true }
        : result(state, this.primarySession(state), true);
    }

    if (action.concurrency === "focus-existing" && !request.approvalToken) {
      const existing = [...this.runs.values()].find((state) => state.snapshot.workspaceId === workspace.id
        && state.snapshot.actionId === action.id
        && (state.snapshot.status === "running" || state.snapshot.status === "ready" || state.snapshot.status === "queued" || state.snapshot.status === "waiting-approval"));
      if (existing) return existing.snapshot.status === "waiting-approval"
        ? { run: structuredClone(existing.snapshot), session: null, focusedExisting: true, needsApproval: true }
        : result(existing, this.primarySession(existing), true);
    }

    const requiresApproval = action.risk === "dangerous" || (requester !== "user" && action.agentPolicy === "ask");
    if (requiresApproval && !this.consumeApproval(request.approvalToken, action, requester, requesterId)) {
      return this.waitForApproval(action, request, workspace.id, requester, requesterId, idempotencyKey);
    }

    const state = this.createRun(action, request, workspace.id, requester, requesterId, idempotencyKey);
    if (idempotencyKey) {
      this.idempotency.set(`${workspace.id}:${requester}:${requesterId ?? "user"}:${idempotencyKey}`, {
        runId: state.snapshot.id,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
      });
    }
    await this.persistAndPublish(state);
    await this.advance(state);
    return result(state, this.primarySession(state), false);
  }

  async approve(token: string): Promise<RunProjectActionResult> {
    this.cleanupExpired();
    const approval = this.approvals.get(token);
    if (!approval) throw new Error("Action approval has expired or does not exist.");
    return this.run({ ...approval.runRequest, approvalToken: token });
  }

  async stop(runId: string): Promise<ActionRunSnapshot> {
    const state = this.runs.get(runId);
    if (!state) throw new Error("Action run does not exist.");
    if (isTerminalRunStatus(state.snapshot.status)) return structuredClone(state.snapshot);
    for (const controller of state.controllers.values()) controller.abort();
    state.controllers.clear();
    for (const session of this.terminals.findByRun(runId)) {
      if (session.exitCode === null) this.terminals.dispose(session.id);
    }
    const now = Date.now();
    state.snapshot.status = "cancelled";
    state.snapshot.finishedAt = now;
    state.snapshot.steps = state.snapshot.steps.map((step) => (
      step.status === "pending" || step.status === "running" || step.status === "ready"
        ? { ...step, status: "cancelled", finishedAt: now, message: "Stopped by request." }
        : step
    ));
    await this.persistAndPublish(state);
    return structuredClone(state.snapshot);
  }

  async retry(runId: string, stepId?: string): Promise<RunProjectActionResult> {
    const livePrevious = this.runs.get(runId);
    const persisted = livePrevious?.snapshot ?? this.workspace.listRuns().find((candidate) => candidate.id === runId);
    if (!persisted) throw new Error("Action run does not exist.");
    const action = this.workspace.action(persisted.actionId, persisted.workspaceId);
    if (!action) throw new Error("Project action no longer exists.");
    const previous: RunState = livePrevious ?? {
      snapshot: persisted,
      action,
      origin: { x: 0, y: 0 },
      controllers: new Map(),
      groupCreated: false,
      requestedTerminalObjectId: null
    };
    const request: RunProjectActionRequest = {
      id: action.id,
      position: previous.origin,
      requester: previous.snapshot.requester,
      requesterId: previous.snapshot.requesterId ?? undefined,
      idempotencyKey: `retry:${runId}:${stepId ?? "all"}:${Date.now()}`
    };
    if (!stepId) return this.run(request);
    const selected = action.steps.find((step) => step.id === stepId);
    if (!selected) throw new Error("Action step does not exist.");
    const dependencyIds = transitiveDependencies(action, stepId);
    const retryAction: ProjectActionDefinition = {
      ...action,
      id: action.id,
      steps: action.steps.filter((step) => dependencyIds.has(step.id) || step.id === stepId)
    };
    const state = this.createRun(retryAction, request, previous.snapshot.workspaceId, request.requester!, request.requesterId ?? null, request.idempotencyKey ?? null);
    await this.persistAndPublish(state);
    await this.advance(state);
    return result(state, this.primarySession(state), false);
  }

  private waitForApproval(
    action: ProjectActionDefinition,
    request: RunProjectActionRequest,
    workspaceId: string,
    requester: "user" | "agent" | "plugin",
    requesterId: string | null,
    idempotencyKey: string | null
  ): RunProjectActionResult {
    const runId = `run-${randomUUID()}`;
    const token = randomUUID();
    const snapshot: ActionRunSnapshot = {
      id: runId,
      actionId: action.id,
      actionRevision: action.revision,
      workspaceId,
      requester,
      requesterId,
      status: "waiting-approval",
      steps: action.steps.map(initialStep),
      startedAt: Date.now(),
      finishedAt: null,
      idempotencyKey
    };
    const state: RunState = { snapshot, action, origin: request.position, controllers: new Map(), groupCreated: false, requestedTerminalObjectId: request.terminalObjectId ?? null };
    this.runs.set(runId, state);
    const approval: ActionApprovalRequest = {
      token,
      actionId: action.id,
      actionRevision: action.revision,
      requester,
      requesterId: requesterId ?? "user",
      expiresAt: Date.now() + APPROVAL_TTL_MS
    };
    this.approvals.set(token, { request: approval, runRequest: { ...request, approvalToken: token }, waitingRunId: runId });
    if (idempotencyKey) {
      this.idempotency.set(`${workspaceId}:${requester}:${requesterId ?? "user"}:${idempotencyKey}`, {
        runId,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
      });
    }
    void this.persistAndPublish(state);
    if (requester !== "user") this.publishApproval(approval);
    return { run: structuredClone(snapshot), session: null, focusedExisting: false, needsApproval: true, approvalToken: requester === "user" ? token : undefined };
  }

  private consumeApproval(
    token: string | undefined,
    action: ProjectActionDefinition,
    requester: "user" | "agent" | "plugin",
    requesterId: string | null
  ): boolean {
    if (!token) return false;
    const approval = this.approvals.get(token);
    if (!approval || approval.request.expiresAt < Date.now()) return false;
    if (approval.request.actionId !== action.id || approval.request.actionRevision !== action.revision) return false;
    if (approval.request.requester !== requester || approval.request.requesterId !== (requesterId ?? "user")) return false;
    this.approvals.delete(token);
    const waiting = this.runs.get(approval.waitingRunId);
    if (waiting) {
      waiting.snapshot.status = "cancelled";
      waiting.snapshot.finishedAt = Date.now();
      void this.persistAndPublish(waiting);
    }
    return true;
  }

  private createRun(
    action: ProjectActionDefinition,
    request: RunProjectActionRequest,
    workspaceId: string,
    requester: "user" | "agent" | "plugin",
    requesterId: string | null,
    idempotencyKey: string | null
  ): RunState {
    const snapshot: ActionRunSnapshot = {
      id: `run-${randomUUID()}`,
      actionId: action.id,
      actionRevision: action.revision,
      workspaceId,
      requester,
      requesterId,
      status: "queued",
      steps: action.steps.map(initialStep),
      startedAt: Date.now(),
      finishedAt: null,
      idempotencyKey
    };
    const state: RunState = {
      snapshot,
      action: structuredClone(action),
      origin: request.position,
      controllers: new Map(),
      groupCreated: false,
      requestedTerminalObjectId: request.terminalObjectId ?? null
    };
    this.runs.set(snapshot.id, state);
    return state;
  }

  private async advance(state: RunState): Promise<void> {
    if (isTerminalRunStatus(state.snapshot.status)) return;
    const ready = state.action.steps.filter((definition) => {
      const step = stepSnapshot(state, definition.id);
      if (step.status !== "pending") return false;
      return definition.dependsOn.every((id) => {
        const dependency = stepSnapshot(state, id);
        return dependency.status === "succeeded" || dependency.status === "ready";
      });
    });
    for (const definition of ready) {
      try {
        await this.startStep(state, definition);
      } catch (error) {
        const step = stepSnapshot(state, definition.id);
        step.status = "failed";
        step.finishedAt = Date.now();
        step.message = error instanceof Error ? error.message.slice(0, 240) : "Action step failed.";
      }
    }
    await this.maybeCreateGroup(state);
    this.deriveRunStatus(state);
    await this.persistAndPublish(state);
  }

  private async startStep(state: RunState, definition: ProjectActionStepDefinition): Promise<void> {
    const step = stepSnapshot(state, definition.id);
    step.status = "running";
    step.startedAt = Date.now();
    state.snapshot.status = "running";
    if (definition.kind === "command") {
      const index = state.action.steps.filter((candidate) => candidate.kind === "command").findIndex((candidate) => candidate.id === definition.id);
      const position = stepPosition(state.origin, index, state.action.autoArrange);
      const reusable = state.requestedTerminalObjectId
        ? this.workspace.terminal(state.requestedTerminalObjectId, state.snapshot.workspaceId)
        : null;
      const terminal = reusable && reusable.actionId === state.action.id
        ? reusable
        : await this.workspace.createActionTerminal(state.action, position, state.snapshot.workspaceId, definition.title, definition.cwd);
      state.requestedTerminalObjectId = null;
      const session = this.terminals.createActionStep(state.action, definition, {
        workspaceId: state.snapshot.workspaceId,
        workspaceObjectId: terminal.id,
        runId: state.snapshot.id,
        stepId: definition.id,
        position,
        size: terminal.size
      });
      step.terminalObjectId = terminal.id;
      step.terminalSessionId = session.id;
      if (session.exitCode !== null) {
        step.status = "failed";
        step.exitCode = session.exitCode;
        step.finishedAt = Date.now();
        step.message = session.failureDetails;
      } else if (definition.mode === "service") {
        step.status = "ready";
      }
      return;
    }
    if (definition.kind === "open-url") {
      await this.openUrl(definition.url!);
      step.status = "succeeded";
      step.finishedAt = Date.now();
      return;
    }
    const controller = new AbortController();
    state.controllers.set(definition.id, controller);
    void this.runHealthcheck(state, definition, controller).finally(() => state.controllers.delete(definition.id));
  }

  private async runHealthcheck(state: RunState, definition: ProjectActionStepDefinition, controller: AbortController): Promise<void> {
    const step = stepSnapshot(state, definition.id);
    const deadline = Date.now() + Math.max(1_000, definition.timeoutMs || 30_000);
    let lastMessage = "Healthcheck did not become ready.";
    while (!controller.signal.aborted && Date.now() < deadline) {
      try {
        if (definition.kind === "http-health") await httpReady(definition.url!, controller.signal);
        else await tcpReady(definition.host!, definition.port!, controller.signal);
        step.status = "succeeded";
        step.finishedAt = Date.now();
        step.message = "Ready";
        await this.advance(state);
        return;
      } catch (error) {
        lastMessage = error instanceof Error ? error.message.slice(0, 240) : lastMessage;
        await delay(HEALTH_POLL_MS, controller.signal).catch(() => undefined);
      }
    }
    if (controller.signal.aborted) {
      step.status = "cancelled";
      step.message = "Healthcheck cancelled.";
    } else {
      step.status = "failed";
      step.message = lastMessage;
    }
    step.finishedAt = Date.now();
    this.deriveRunStatus(state);
    await this.persistAndPublish(state);
  }

  private onTerminalSession(session: SessionMetadata): void {
    if (!session.actionRunId || !session.actionStepId || session.exitCode === null) return;
    const state = this.runs.get(session.actionRunId);
    if (!state || isTerminalRunStatus(state.snapshot.status)) return;
    const step = state.snapshot.steps.find((candidate) => candidate.stepId === session.actionStepId);
    if (!step) return;
    step.exitCode = session.exitCode;
    step.finishedAt = Date.now();
    step.status = session.exitCode === 0 ? "succeeded" : "failed";
    step.message = session.exitCode === 0 ? null : session.failureDetails ?? `Exited with code ${session.exitCode}.`;
    void this.advance(state);
  }

  private deriveRunStatus(state: RunState): void {
    const steps = state.snapshot.steps;
    if (steps.some((step) => step.status === "failed")) {
      state.snapshot.steps = steps.map((step) => step.status === "pending"
        ? { ...step, status: "skipped", finishedAt: Date.now(), message: "Skipped because a dependency failed." }
        : step);
      state.snapshot.status = "failed";
      state.snapshot.finishedAt = Date.now();
      return;
    }
    if (steps.some((step) => step.status === "running" || step.status === "pending")) {
      state.snapshot.status = "running";
      return;
    }
    if (steps.some((step) => step.status === "cancelled")) {
      state.snapshot.status = "cancelled";
      state.snapshot.finishedAt = Date.now();
      return;
    }
    const hasLiveService = state.action.steps.some((definition) => definition.mode === "service"
      && stepSnapshot(state, definition.id).status === "ready");
    state.snapshot.status = hasLiveService ? "ready" : "succeeded";
    state.snapshot.finishedAt = hasLiveService ? null : Date.now();
  }

  private async maybeCreateGroup(state: RunState): Promise<void> {
    if (!state.action.autoGroup || state.groupCreated) return;
    const memberIds = state.snapshot.steps.map((step) => step.terminalObjectId).filter((id): id is string => Boolean(id));
    const commandCount = state.action.steps.filter((step) => step.kind === "command").length;
    if (memberIds.length < commandCount || memberIds.length < 2) return;
    const group: WorkspaceGroupInput = {
      title: state.action.title,
      color: "sage",
      position: { x: state.origin.x - 28, y: state.origin.y - 72 },
      size: groupSize(commandCount, state.action.autoArrange),
      memberIds
    };
    await this.workspace.createGroup(group);
    state.groupCreated = true;
  }

  private primarySession(state: RunState): SessionSnapshot | null {
    const sessionId = state.snapshot.steps.find((step) => step.terminalSessionId)?.terminalSessionId;
    return sessionId ? this.terminals.list().find((session) => session.id === sessionId) ?? null : null;
  }

  private async persistAndPublish(state: RunState): Promise<void> {
    await this.workspace.recordRun(state.snapshot);
    this.publishRun({ run: structuredClone(state.snapshot) });
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, approval] of this.approvals) if (approval.request.expiresAt < now) this.approvals.delete(token);
    for (const [key, value] of this.idempotency) if (value.expiresAt < now) this.idempotency.delete(key);
  }
}

function initialStep(definition: ProjectActionStepDefinition): ActionStepRunSnapshot {
  return {
    stepId: definition.id,
    title: definition.title,
    status: "pending",
    terminalSessionId: null,
    terminalObjectId: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    message: null
  };
}

function stepSnapshot(state: RunState, id: string): ActionStepRunSnapshot {
  const step = state.snapshot.steps.find((candidate) => candidate.stepId === id);
  if (!step) throw new Error(`Action step snapshot is missing: ${id}.`);
  return step;
}

function result(state: RunState, session: SessionSnapshot | null, focusedExisting: boolean): RunProjectActionResult {
  return { run: structuredClone(state.snapshot), session, focusedExisting, needsApproval: false };
}

function isTerminalRunStatus(status: ActionRunSnapshot["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function stepPosition(origin: Point, index: number, mode: ProjectActionDefinition["autoArrange"]): Point {
  if (mode === "columns") return { x: origin.x, y: origin.y + Math.max(0, index) * 470 };
  if (mode === "rows") return { x: origin.x + Math.max(0, index) * 740, y: origin.y };
  return { x: origin.x + (Math.max(0, index) % 2) * 740, y: origin.y + Math.floor(Math.max(0, index) / 2) * 470 };
}

function groupSize(count: number, mode: ProjectActionDefinition["autoArrange"]): { width: number; height: number } {
  if (mode === "columns") return { width: 760, height: count * 470 + 120 };
  if (mode === "rows") return { width: count * 740 + 80, height: 560 };
  const columns = Math.min(2, count);
  return { width: columns * 740 + 80, height: Math.ceil(count / columns) * 470 + 120 };
}

function transitiveDependencies(action: ProjectActionDefinition, stepId: string): Set<string> {
  const result = new Set<string>();
  const byId = new Map(action.steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      visit(dependency);
    }
  };
  visit(stepId);
  return result;
}

async function httpReady(url: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { method: "GET", redirect: "manual", signal });
  if (response.status >= 500) throw new Error(`Healthcheck returned HTTP ${response.status}.`);
  await response.body?.cancel().catch(() => undefined);
}

function tcpReady(host: string, port: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
      socket.removeAllListeners();
      socket.destroy();
    };
    const abort = (): void => {
      cleanup();
      reject(new Error("Healthcheck cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    socket.setTimeout(1_500);
    socket.once("connect", () => { cleanup(); resolve(); });
    socket.once("timeout", () => { cleanup(); reject(new Error("TCP healthcheck timed out.")); });
    socket.once("error", (error) => { cleanup(); reject(error); });
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Cancelled."));
    }, { once: true });
  });
}
