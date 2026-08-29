import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  WorkspaceStore
} from "../src/main/services/WorkspaceStore.ts";
import { WorkspaceIndexStore } from "../src/main/services/WorkspaceIndexStore.ts";
import { createDefaultWorkspace, normalizeWorkspace } from "../src/main/services/workspaceNormalization.ts";

function createStore(userData, publish = () => undefined) {
  return new WorkspaceStore(userData, new WorkspaceIndexStore(userData), publish);
}

test("workspace store persists normalized terminal cards and reloads them", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-workspace-"));
  try {
    const store = createStore(userData);
    await store.load();
    const terminal = await store.createTerminal({
      provider: "terminal",
      profile: "normal",
      cwd: userData,
      position: { x: 120, y: 240 }
    });
    await store.updateTerminalBounds(terminal.id, {
      position: { x: 333, y: 444 },
      size: { width: 880, height: 520 }
    });

    const reloaded = createStore(userData);
    const { workspace: snapshot } = await reloaded.load();
    assert.equal(snapshot.terminals.length, 1);
    assert.deepEqual(snapshot.terminals[0].position, { x: 333, y: 444 });
    assert.deepEqual(snapshot.terminals[0].size, { width: 880, height: 520 });
    assert.equal(snapshot.terminals[0].titleCustomized, false);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("workspace mutations serialize and publish host-confirmed revisions", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-workspace-"));
  const revisions = [];
  try {
    const store = createStore(userData, (snapshot) => revisions.push(snapshot.revision));
    await store.load();
    revisions.length = 0;
    const first = store.renameWorkspace("ML workspace");
    const second = store.renameWorkspace("VPN workspace");
    const [, result] = await Promise.all([first, second]);

    assert.equal(result.title, "VPN workspace");
    assert.deepEqual(revisions, [1, 2]);
    const persisted = JSON.parse(await readFile(join(userData, "workspaces", "default.json"), "utf8"));
    assert.equal(persisted.revision, 2);
    assert.equal(persisted.title, "VPN workspace");
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("project actions persist as definitions and detach their saved terminals when removed", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-workspace-"));
  try {
    const store = createStore(userData);
    await store.load();
    const withAction = await store.createAction({
      title: "Run tests",
      description: "Execute the project test suite",
      command: "npm test",
      cwd: userData,
      risk: "safe",
      concurrency: "focus-existing",
      pinned: true
    });
    const action = withAction.actions[0];
    assert.ok(action.id.startsWith("action-"));
    assert.equal(store.listActions()[0].command, "npm test");

    const terminal = await store.createActionTerminal(action, { x: 10, y: 20 });
    assert.equal(terminal.actionId, action.id);
    const withoutAction = await store.removeAction(action.id);
    assert.deepEqual(withoutAction.actions, []);
    assert.equal(withoutAction.terminals[0].actionId, null);

    const reloaded = createStore(userData);
    const { workspace: persisted } = await reloaded.load();
    assert.deepEqual(persisted.actions, []);
    assert.equal(persisted.terminals[0].actionId, null);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("project actions reject empty commands and unknown policies", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-workspace-"));
  try {
    const store = createStore(userData);
    await store.load();
    assert.throws(() => store.createAction({
      title: "Broken",
      description: "",
      command: "   ",
      cwd: userData,
      risk: "safe",
      concurrency: "focus-existing"
    }), /command is required/i);
    assert.throws(() => store.createAction({
      title: "Broken",
      description: "",
      command: "true",
      cwd: userData,
      risk: "safe",
      concurrency: "replace-everything"
    }), /concurrency is invalid/i);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});

test("workspace normalization rejects malformed objects and clamps geometry", () => {
  const fallback = createDefaultWorkspace(10);
  const snapshot = normalizeWorkspace({
    schemaVersion: 999,
    id: "attacker-controlled",
    revision: 4,
    title: "  Spatial  ",
    updatedAt: 20,
    terminals: [
      {
        id: "terminal-00000000-0000-4000-8000-000000000000",
        kind: "terminal",
        provider: "terminal",
        profile: "normal",
        title: "Shell",
        titleCustomized: true,
        cwd: "/tmp",
        position: { x: 9_000_000, y: -9_000_000 },
        size: { width: 20, height: 50_000 },
        createdAt: 1,
        updatedAt: 2
      },
      { id: "not-valid", kind: "terminal" }
    ]
  }, fallback);

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.id, "default");
  assert.equal(snapshot.title, "Spatial");
  assert.equal(snapshot.terminals.length, 1);
  assert.deepEqual(snapshot.terminals[0].position, { x: 1_000_000, y: -1_000_000 });
  assert.deepEqual(snapshot.terminals[0].size, { width: 420, height: 1_100 });
});

test("a malformed persisted workspace falls back without escaping its file", async () => {
  const userData = await mkdtemp(join(tmpdir(), "canvastty-workspace-"));
  try {
    await writeFile(join(userData, "workspace.json"), "{broken", "utf8");
    const store = createStore(userData);
    const { workspace: snapshot } = await store.load();
    assert.equal(snapshot.id, "default");
    assert.deepEqual(snapshot.terminals, []);
  } finally {
    await rm(userData, { recursive: true, force: true });
  }
});
