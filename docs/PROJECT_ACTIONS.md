# Workspaces and Project Actions

[English](PROJECT_ACTIONS.md) · [Русский](PROJECT_ACTIONS.ru.md) · [Documentation](README.md)

CanvasTTY workspaces persist the spatial definition of a project: terminal cards, groups, camera, saved views, terminal templates, Project Actions, plugin cards, and Browser-card geometry. A restart restores cards as honest stopped placeholders; it never claims that an exited operating-system process is still running.

## User flow

### Workspaces

Click the workspace name in the title bar to switch, create, rename, duplicate, or delete a workspace. The live-process badge shows how many PTYs still belong to it. Deletion is blocked for the last workspace and while the target owns live processes.

Open **Manage workspace** from that menu or the gear button in the canvas dock:

- **Layout** sets the project folder, arranges cards as a grid/column/row, creates movable group frames, and saves camera views.
- **Templates** stores a repeatable terminal title, working folder, profile, size, and optional startup command.
- **Presets & transfer** saves groups, actions, and templates as a reusable preset, or exports/imports a sanitized workspace JSON document. Live processes, Browser tabs, and plugin runtime state are not exported.

Groups own an explicit card list. Dragging a frame moves its members together; **Collapse** hides member cards; **Lock** protects the frame and members from auto-arrange.

### Project Actions

Click the lightning button in the canvas dock, or use **Open Project Actions** from `Ctrl/Cmd+Shift+P`.

1. Set the project folder in **Manage workspace**.
2. Click **Discover** to preview actions from `package.json`, `justfile`, `Makefile`, `Taskfile`, Docker Compose, and supported files under `scripts/`.
3. Select only the commands you want and import them. Discovery does not execute project files.
4. Run an action by its intention-oriented title, such as **Start development environment** or **Run tests**.
5. Expand the action to inspect its exact command, working folder, source, policy, steps, current state, exit code, and recent runs.

Use **New** to create a custom action. A multi-step action can contain:

| Step | Purpose |
|:--|:--|
| Command task | Run a finite command and continue only after exit code `0` |
| Command service | Keep a long-running PTY visible while dependent checks continue |
| HTTP health | Poll an HTTP(S) endpoint until it responds successfully or times out |
| TCP health | Wait until a host and port accept connections |
| Open URL | Open a verified HTTP(S) URL in the workspace Browser card |

Dependencies form a validated acyclic graph. Independent ready steps may run together. A failed step marks blocked dependants as skipped. **Retry** repeats the complete action; **Retry step** repeats that step and its dependencies. **Stop** aborts checks and disposes the action's live PTYs.

## Safety and repeatability

- `focus-existing` returns to a matching active run instead of starting a duplicate; `parallel` intentionally creates another run.
- An idempotency key returns the same recent run to an agent/plugin after a repeated request.
- `safe`, `write`, and `dangerous` describe risk. Dangerous actions always show their exact command and working folder before a human run.
- `deny`, `ask`, and `allow` control external agent/plugin access. `ask` creates an approval card in Project Actions; the token expires and is bound to the action revision and requester.
- Agents and plugins invoke an immutable action ID. They cannot replace its command, arguments, working directory, steps, or risk policy.
- Run history is bounded and persists structured states; terminal output remains in the corresponding terminal card.

## Agent tools

Supported CanvasTTY-launched MCP-capable agents receive five project tools in addition to any enabled Browser tools:

```text
project_actions_list
project_actions_describe
project_actions_run
project_actions_status
project_actions_stop
```

The list omits actions with `agentPolicy: "deny"`. Run requires only the action ID and an optional idempotency key. The host derives the workspace and requester identity from the authenticated PTY, so an agent cannot target another workspace or stop another requester's run.

## Plugin boundary

Runtime plugins remain sandboxed. A plugin may request:

- `actions:read` for `CanvasTTYPlugin.actions.list()`;
- `actions:run-approved` for `CanvasTTYPlugin.actions.run(actionId, idempotencyKey?)`.

The second permission does not expose a shell or process API. Host policy still applies, and `ask` actions enter the human approval queue. Approval tokens never cross the plugin boundary.

## Persistence ownership

The main process owns versioned workspace documents under Electron `userData`; the renderer receives normalized snapshots through the typed preload bridge. `WorkspaceStore` serializes atomic document mutations, `WorkspaceIndexStore` owns the catalog and presets, `ActionSourceRegistry` performs bounded read-only discovery, and `ActionRunManager` owns approvals, concurrency, execution, health checks, and structured run state.

The command palette uses `Ctrl/Cmd+Shift+P`. `Ctrl+K` remains available to terminal applications.
