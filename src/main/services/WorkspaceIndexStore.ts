import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  WorkspaceCatalogSnapshot,
  WorkspacePreset,
  WorkspaceSummary
} from "../../shared/contracts.ts";
import { DEFAULT_WORKSPACE_ID } from "../../shared/contracts.ts";
import { isRecord, isWorkspaceId, workspaceObjectId } from "./workspaceNormalization.ts";

interface PersistedWorkspaceIndex {
  revision: number;
  activeId: string;
  workspaces: WorkspaceSummary[];
  presets: WorkspacePreset[];
}

type PublishCatalog = (catalog: WorkspaceCatalogSnapshot) => void;

export class WorkspaceIndexStore {
  readonly rootPath: string;
  private readonly indexPath: string;
  private readonly publish: PublishCatalog;
  private value: PersistedWorkspaceIndex = {
    revision: 0,
    activeId: DEFAULT_WORKSPACE_ID,
    workspaces: [],
    presets: []
  };
  private queue = Promise.resolve();

  constructor(userDataPath: string, publish: PublishCatalog = () => undefined) {
    this.rootPath = join(userDataPath, "workspaces");
    this.indexPath = join(this.rootPath, "index.json");
    this.publish = publish;
  }

  async load(): Promise<WorkspaceCatalogSnapshot> {
    await mkdir(this.rootPath, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      this.value = normalizeIndex(JSON.parse(raw), this.value);
    } catch (error) {
      if (!isMissingFile(error)) console.warn("CanvasTTY workspace index could not be loaded; it will be repaired.", error);
      await this.persist(this.value);
    }
    return this.get();
  }

  get(): WorkspaceCatalogSnapshot {
    return structuredClone(this.value);
  }

  documentPath(id: string): string {
    if (!isWorkspaceId(id)) throw new Error("Workspace identifier is invalid.");
    return join(this.rootPath, `${id}.json`);
  }

  setActive(id: string): Promise<WorkspaceCatalogSnapshot> {
    return this.mutate((current) => {
      if (!current.workspaces.some((workspace) => workspace.id === id)) throw new Error("Workspace does not exist.");
      return { ...current, activeId: id };
    });
  }

  upsert(summary: WorkspaceSummary, activate = false): Promise<WorkspaceCatalogSnapshot> {
    if (!isWorkspaceId(summary.id)) return Promise.reject(new Error("Workspace identifier is invalid."));
    return this.mutate((current) => {
      const workspaces = current.workspaces.some((candidate) => candidate.id === summary.id)
        ? current.workspaces.map((candidate) => candidate.id === summary.id ? structuredClone(summary) : candidate)
        : [...current.workspaces, structuredClone(summary)];
      return { ...current, activeId: activate ? summary.id : current.activeId, workspaces };
    });
  }

  remove(id: string): Promise<WorkspaceCatalogSnapshot> {
    return this.mutate((current) => {
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== id);
      if (workspaces.length === current.workspaces.length) return current;
      if (workspaces.length === 0) throw new Error("The final workspace cannot be removed.");
      return {
        ...current,
        activeId: current.activeId === id ? workspaces[0]!.id : current.activeId,
        workspaces
      };
    });
  }

  savePreset(preset: WorkspacePreset): Promise<WorkspaceCatalogSnapshot> {
    if (!workspaceObjectId(preset.id, "preset")) return Promise.reject(new Error("Workspace preset identifier is invalid."));
    return this.mutate((current) => ({
      ...current,
      presets: current.presets.some((candidate) => candidate.id === preset.id)
        ? current.presets.map((candidate) => candidate.id === preset.id ? structuredClone(preset) : candidate)
        : [...current.presets, structuredClone(preset)]
    }));
  }

  removePreset(id: string): Promise<WorkspaceCatalogSnapshot> {
    return this.mutate((current) => ({ ...current, presets: current.presets.filter((preset) => preset.id !== id) }));
  }

  private mutate(update: (current: PersistedWorkspaceIndex) => PersistedWorkspaceIndex): Promise<WorkspaceCatalogSnapshot> {
    const operation = this.queue.catch(() => undefined).then(async () => {
      const candidate = update(structuredClone(this.value));
      if (candidate === this.value) return this.get();
      const next = normalizeIndex({ ...candidate, revision: this.value.revision + 1 }, this.value);
      await this.persist(next);
      this.value = next;
      const snapshot = this.get();
      this.publish(snapshot);
      return snapshot;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persist(value: PersistedWorkspaceIndex): Promise<void> {
    const temporary = `${this.indexPath}.tmp`;
    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, this.indexPath);
  }
}

function normalizeIndex(candidate: unknown, fallback: PersistedWorkspaceIndex): PersistedWorkspaceIndex {
  if (!isRecord(candidate)) return structuredClone(fallback);
  const workspaces = Array.isArray(candidate.workspaces)
    ? candidate.workspaces.slice(0, 64).flatMap((value) => normalizeSummary(value))
    : fallback.workspaces.map((summary) => structuredClone(summary));
  const ids = new Set<string>();
  const unique = workspaces.filter((summary) => !ids.has(summary.id) && ids.add(summary.id));
  const activeId = isWorkspaceId(candidate.activeId) && unique.some((summary) => summary.id === candidate.activeId)
    ? candidate.activeId
    : unique[0]?.id ?? DEFAULT_WORKSPACE_ID;
  return {
    revision: Number.isSafeInteger(candidate.revision) && Number(candidate.revision) >= 0 ? Number(candidate.revision) : fallback.revision,
    activeId,
    workspaces: unique,
    presets: Array.isArray(candidate.presets) ? candidate.presets.slice(0, 64) as WorkspacePreset[] : structuredClone(fallback.presets)
  };
}

function normalizeSummary(candidate: unknown): WorkspaceSummary[] {
  if (!isRecord(candidate) || !isWorkspaceId(candidate.id)) return [];
  return [{
    id: candidate.id,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 80) : "Workspace",
    projectRoot: typeof candidate.projectRoot === "string" ? candidate.projectRoot.slice(0, 4_096) : "",
    objectCount: Number.isSafeInteger(candidate.objectCount) ? Math.max(0, Number(candidate.objectCount)) : 0,
    updatedAt: Number.isSafeInteger(candidate.updatedAt) ? Math.max(0, Number(candidate.updatedAt)) : 0
  }];
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
