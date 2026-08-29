import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { delimiter, extname, join, relative, resolve } from "node:path";
import { constants } from "node:fs";
import type {
  ActionDiscoveryResult,
  DiscoveredAction,
  ProjectActionInput,
  ProjectActionSourceKind
} from "../../shared/contracts.ts";

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_DISCOVERED_ACTIONS = 160;

export class ActionSourceRegistry {
  async discover(root: string): Promise<ActionDiscoveryResult> {
    const projectRoot = resolve(root);
    await assertDirectory(projectRoot);
    const results = await Promise.all([
      this.packageJson(projectRoot),
      this.justfile(projectRoot),
      this.makefile(projectRoot),
      this.taskfile(projectRoot),
      this.dockerCompose(projectRoot),
      this.scripts(projectRoot)
    ]);
    return {
      root: projectRoot,
      sources: results.filter((result) => result.present).map(({ kind, path, actions, error }) => ({ kind, path, count: actions.length, error })),
      actions: results.flatMap((result) => result.actions).slice(0, MAX_DISCOVERED_ACTIONS)
    };
  }

  private async packageJson(root: string): Promise<SourceResult> {
    const path = join(root, "package.json");
    try {
      const parsed: unknown = JSON.parse(await boundedRead(path));
      if (!isRecord(parsed) || !isRecord(parsed.scripts)) throw new Error("package.json scripts must be an object.");
      const actions = Object.entries(parsed.scripts).flatMap(([name, value]) => {
        if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(name) || typeof value !== "string") return [];
        return [discovered("package-json", path, name, {
          title: humanize(name),
          description: value.slice(0, 240),
          command: `npm run ${name}`,
          cwd: root,
          risk: inferRisk(name),
          concurrency: isLongRunning(name) ? "focus-existing" : "parallel",
          agentPolicy: inferRisk(name) === "dangerous" ? "ask" : "allow",
          steps: [{ title: humanize(name), kind: "command", execution: "argv", executable: "npm", args: ["run", name], cwd: root, mode: isLongRunning(name) ? "service" : "task" }],
          source: { kind: "package-json", path, key: name }
        })];
      });
      return source("package-json", path, actions);
    } catch (error) {
      return sourceError("package-json", path, error);
    }
  }

  private async justfile(root: string): Promise<SourceResult> {
    const path = await firstExisting([join(root, "justfile"), join(root, "Justfile"), join(root, ".justfile")]);
    if (!path) return missing("just", join(root, "justfile"));
    try {
      const raw = await boundedRead(path);
      const available = await executableAvailable("just");
      const actions: DiscoveredAction[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)(?:\s+[^:=]+)?\s*:(?![=])/.exec(line);
        if (!match?.[1] || match[1].startsWith("_")) continue;
        const name = match[1];
        actions.push(discovered("just", path, name, {
          title: humanize(name),
          description: `just ${name}`,
          command: `just ${name}`,
          cwd: root,
          risk: inferRisk(name),
          concurrency: isLongRunning(name) ? "focus-existing" : "parallel",
          agentPolicy: inferRisk(name) === "dangerous" ? "ask" : "allow",
          steps: [{ title: humanize(name), kind: "command", execution: "argv", executable: "just", args: [name], cwd: root, mode: isLongRunning(name) ? "service" : "task" }],
          source: { kind: "just", path, key: name }
        }, available, available ? null : "The just CLI is not currently available on PATH."));
      }
      return source("just", path, actions);
    } catch (error) {
      return sourceError("just", path, error);
    }
  }

  private async makefile(root: string): Promise<SourceResult> {
    const path = await firstExisting([join(root, "Makefile"), join(root, "makefile")]);
    if (!path) return missing("make", join(root, "Makefile"));
    try {
      const raw = await boundedRead(path);
      const actions: DiscoveredAction[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const match = /^([a-zA-Z0-9][a-zA-Z0-9_.-]*):(?:\s|$)/.exec(line);
        if (!match?.[1] || match[1].startsWith(".")) continue;
        const name = match[1];
        actions.push(discovered("make", path, name, {
          title: humanize(name), description: `make ${name}`, command: `make ${name}`, cwd: root,
          risk: inferRisk(name), concurrency: isLongRunning(name) ? "focus-existing" : "parallel",
          agentPolicy: inferRisk(name) === "dangerous" ? "ask" : "allow",
          steps: [{ title: humanize(name), kind: "command", execution: "argv", executable: "make", args: [name], cwd: root, mode: isLongRunning(name) ? "service" : "task" }],
          source: { kind: "make", path, key: name }
        }));
      }
      return source("make", path, dedupe(actions));
    } catch (error) {
      return sourceError("make", path, error);
    }
  }

  private async taskfile(root: string): Promise<SourceResult> {
    const path = await firstExisting([join(root, "Taskfile.yml"), join(root, "Taskfile.yaml"), join(root, "taskfile.yml")]);
    if (!path) return missing("taskfile", join(root, "Taskfile.yml"));
    try {
      const raw = await boundedRead(path);
      const tasksSection = /^tasks:\s*$/m.exec(raw);
      if (tasksSection?.index === undefined) return source("taskfile", path, []);
      const tail = raw.slice(tasksSection.index + tasksSection[0].length);
      const actions: DiscoveredAction[] = [];
      for (const line of tail.split(/\r?\n/)) {
        const match = /^ {2}([a-zA-Z0-9][a-zA-Z0-9:_-]*):\s*(?:#.*)?$/.exec(line);
        if (!match?.[1]) continue;
        const name = match[1];
        actions.push(discovered("taskfile", path, name, {
          title: humanize(name), description: `task ${name}`, command: `task ${name}`, cwd: root,
          risk: inferRisk(name), concurrency: isLongRunning(name) ? "focus-existing" : "parallel",
          agentPolicy: inferRisk(name) === "dangerous" ? "ask" : "allow",
          steps: [{ title: humanize(name), kind: "command", execution: "argv", executable: "task", args: [name], cwd: root, mode: isLongRunning(name) ? "service" : "task" }],
          source: { kind: "taskfile", path, key: name }
        }));
      }
      return source("taskfile", path, actions);
    } catch (error) {
      return sourceError("taskfile", path, error);
    }
  }

  private async dockerCompose(root: string): Promise<SourceResult> {
    const path = await firstExisting(["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"].map((name) => join(root, name)));
    if (!path) return missing("docker-compose", join(root, "compose.yml"));
    try {
      const raw = await boundedRead(path);
      const servicesMatch = /^services:\s*$/m.exec(raw);
      if (servicesMatch?.index === undefined) return source("docker-compose", path, []);
      const actions: DiscoveredAction[] = [];
      for (const line of raw.slice(servicesMatch.index + servicesMatch[0].length).split(/\r?\n/)) {
        const match = /^ {2}([a-zA-Z0-9][a-zA-Z0-9_.-]*):\s*(?:#.*)?$/.exec(line);
        if (!match?.[1]) continue;
        const name = match[1];
        actions.push(discovered("docker-compose", path, name, {
          title: `Start ${humanize(name)}`,
          description: `Start the ${name} Docker Compose service`,
          command: `docker compose up ${name}`,
          cwd: root,
          risk: "write",
          concurrency: "focus-existing",
          agentPolicy: "ask",
          steps: [{ title: `Docker · ${name}`, kind: "command", execution: "argv", executable: "docker", args: ["compose", "up", name], cwd: root, mode: "service" }],
          source: { kind: "docker-compose", path, key: name }
        }));
      }
      return source("docker-compose", path, actions);
    } catch (error) {
      return sourceError("docker-compose", path, error);
    }
  }

  private async scripts(root: string): Promise<SourceResult> {
    const directory = join(root, "scripts");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      return isMissing(error) ? missing("script", directory) : sourceError("script", directory, error);
    }
    const actions: DiscoveredAction[] = [];
    for (const entry of entries.slice(0, 128)) {
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      const launch = scriptLaunch(extension, join(directory, entry.name));
      if (!launch) continue;
      const name = entry.name.slice(0, -extension.length);
      actions.push(discovered("script", join(directory, entry.name), entry.name, {
        title: humanize(name), description: `scripts/${entry.name}`, command: `${launch.executable} ${relative(root, launch.args[0] ?? "")}`.trim(), cwd: root,
        risk: inferRisk(name), concurrency: isLongRunning(name) ? "focus-existing" : "parallel",
        agentPolicy: inferRisk(name) === "dangerous" ? "ask" : "allow",
        steps: [{ title: humanize(name), kind: "command", execution: "argv", executable: launch.executable, args: launch.args, cwd: root, mode: isLongRunning(name) ? "service" : "task" }],
        source: { kind: "script", path: join(directory, entry.name), key: entry.name }
      }));
    }
    return source("script", directory, actions);
  }
}

interface SourceResult {
  kind: ProjectActionSourceKind;
  path: string;
  present: boolean;
  actions: DiscoveredAction[];
  error: string | null;
}

function source(kind: ProjectActionSourceKind, path: string, actions: DiscoveredAction[]): SourceResult {
  return { kind, path, present: true, actions, error: null };
}

function missing(kind: ProjectActionSourceKind, path: string): SourceResult {
  return { kind, path, present: false, actions: [], error: null };
}

function sourceError(kind: ProjectActionSourceKind, path: string, error: unknown): SourceResult {
  if (isMissing(error)) return missing(kind, path);
  return { kind, path, present: true, actions: [], error: error instanceof Error ? error.message.slice(0, 240) : "Source could not be read." };
}

function discovered(kind: ProjectActionSourceKind, path: string, key: string, input: ProjectActionInput, available = true, message: string | null = null): DiscoveredAction {
  const importId = createHash("sha256").update(`${kind}\0${path}\0${key}`).digest("hex").slice(0, 24);
  return { importId, input, available, message };
}

function dedupe(actions: DiscoveredAction[]): DiscoveredAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => !seen.has(action.importId) && seen.add(action.importId));
}

async function boundedRead(path: string): Promise<string> {
  const raw = await readFile(path);
  if (raw.byteLength > MAX_SOURCE_BYTES) throw new Error("Source file is too large to inspect.");
  return raw.toString("utf8");
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue to the next canonical filename.
    }
  }
  return null;
}

async function assertDirectory(path: string): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) throw new Error(`Project folder does not exist: ${path}`);
}

async function executableAvailable(name: string): Promise<boolean> {
  const candidates = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, process.platform === "win32" ? `${name}.exe` : name));
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      // Continue.
    }
  }
  return false;
}

function scriptLaunch(extension: string, path: string): { executable: string; args: string[] } | null {
  if (extension === ".py") return { executable: process.platform === "win32" ? "python" : "python3", args: [path] };
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return { executable: process.execPath, args: [path] };
  if (extension === ".ts") return { executable: "npx", args: ["tsx", path] };
  if (extension === ".sh") return { executable: "bash", args: [path] };
  if (extension === ".ps1") return { executable: process.platform === "win32" ? "powershell.exe" : "pwsh", args: ["-File", path] };
  return null;
}

function inferRisk(name: string): ProjectActionInput["risk"] {
  const normalized = name.toLowerCase();
  if (/(reset|clean|delete|destroy|drop|prune|deploy|publish|release|migrate)/.test(normalized)) return "dangerous";
  if (/(build|format|fix|install|seed|generate|up|start|dev|serve|train)/.test(normalized)) return "write";
  return "safe";
}

function isLongRunning(name: string): boolean {
  return /(^|[-_:])(dev|serve|server|watch|start|up|logs|worker|train)($|[-_:])/.test(name.toLowerCase());
}

function humanize(value: string): string {
  const text = value.replace(/[-_:]+/g, " ").trim();
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
