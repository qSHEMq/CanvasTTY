import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionDiscoveryResult,
  ActionApprovalRequest,
  ActionRunSnapshot,
  LocaleId,
  ProjectActionDefinition,
  ProjectActionInput,
  ProjectActionStepInput,
  SessionSnapshot
} from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";

interface ActionsPanelProps {
  open: boolean;
  locale: LocaleId;
  workspaceTitle: string;
  actions: ProjectActionDefinition[];
  approvals: ActionApprovalRequest[];
  runs: ActionRunSnapshot[];
  sessions: SessionSnapshot[];
  defaultCwd: string;
  onClose(): void;
  onCreate(input: ProjectActionInput): Promise<void>;
  onUpdate(id: string, input: ProjectActionInput): Promise<void>;
  onRemove(id: string): Promise<void>;
  onRun(action: ProjectActionDefinition): Promise<void>;
  onStop(runId: string): Promise<void>;
  onRetry(runId: string, stepId?: string): Promise<void>;
  onApprove(token: string): Promise<void>;
  onDiscover(): Promise<ActionDiscoveryResult>;
  onImport(inputs: ProjectActionInput[]): Promise<void>;
  onChooseFolder(defaultPath: string): Promise<string | null>;
}

interface EditorState { id: string | null; value: ProjectActionInput }
interface ApprovalState { action: ProjectActionDefinition; token?: string; retry?: { runId: string; stepId?: string } }

export function ActionsPanel(props: ActionsPanelProps): React.JSX.Element {
  const { open, locale, workspaceTitle, actions, runs, defaultCwd, onClose } = props;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<ActionDiscoveryResult | null>(null);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) { setEditor(null); setApproval(null); setRemovingId(null); setDiscovery(null); setError(null); return; }
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (approval) setApproval(null);
      else if (editor) setEditor(null);
      else if (discovery) setDiscovery(null);
      else onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [approval, discovery, editor, onClose, open]);

  const latestRunByAction = useMemo(() => {
    const result = new Map<string, ActionRunSnapshot>();
    for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) if (!result.has(run.actionId)) result.set(run.actionId, run);
    return result;
  }, [runs]);
  const visibleActions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return [...actions]
      .filter((action) => !needle || [action.title, action.description, action.command, action.source?.kind ?? ""].some((value) => value.toLocaleLowerCase(locale).includes(needle)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title, locale));
  }, [actions, locale, query]);

  const perform = async (id: string, task: () => Promise<void>): Promise<void> => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try { await task(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : copy(locale, "Действие не выполнено", "Action failed")); }
    finally { setBusyId(null); }
  };
  const beginCreate = (): void => setEditor({ id: null, value: defaultAction(defaultCwd) });
  const beginEdit = (action: ProjectActionDefinition): void => setEditor({
    id: action.id,
    value: {
      title: action.title, description: action.description, command: action.command, cwd: action.cwd,
      risk: action.risk, concurrency: action.concurrency, agentPolicy: action.agentPolicy,
      steps: action.steps, autoGroup: action.autoGroup, autoArrange: action.autoArrange,
      source: action.source, pinned: action.pinned
    }
  });
  const requestRun = (action: ProjectActionDefinition): void => action.risk === "dangerous" ? setApproval({ action }) : void perform(action.id, () => props.onRun(action));
  const discover = (): void => void perform("discovery", async () => {
    const result = await props.onDiscover();
    setDiscovery(result);
    setSelectedImports(new Set(result.actions.filter((action) => action.available).map((action) => action.importId)));
  });

  return (
    <div className={`actions-backdrop ${open ? "actions-backdrop--open" : ""}`} aria-hidden={!open} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={`actions-panel ${open ? "actions-panel--open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="actions-title">
        <header className="actions-panel__header">
          <div><span>{workspaceTitle}</span><h2 id="actions-title">{copy(locale, "Действия проекта", "Project Actions")}</h2></div>
          <div className="actions-panel__header-actions">
            <button type="button" disabled={busyId !== null} onClick={discover}><UiIcon name={busyId === "discovery" ? "working" : "download"} size={16} />{copy(locale, "Найти", "Discover")}</button>
            <button type="button" onClick={beginCreate}><UiIcon name="plus" size={16} />{copy(locale, "Новое", "New")}</button>
            <button ref={closeButton} className="actions-panel__close" type="button" onClick={onClose}><UiIcon name="close" size={18} /></button>
          </div>
        </header>
        <div className="actions-panel__search"><UiIcon name="bolt" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy(locale, "Поиск actions", "Search actions")} /></div>
        {error && <div className="actions-panel__error" role="alert">{error}</div>}
        {props.approvals.length > 0 && <div className="action-approval-queue">{props.approvals.map((request) => { const action = actions.find((candidate) => candidate.id === request.actionId); const source = request.requester === "plugin" ? copy(locale, "Плагин", "Plugin") : copy(locale, "Агент", "Agent"); return action ? <button key={request.token} type="button" onClick={() => setApproval({ action, token: request.token })}><UiIcon name="attention" size={16} /><span><strong>{source} {copy(locale, "просит запустить", "requests")}: {action.title}</strong><small>{request.requesterId} · {action.risk}</small></span><em>{copy(locale, "Проверить", "Review")}</em></button> : null; })}</div>}
        <div className="actions-panel__content">
          {actions.length === 0 ? <section className="actions-empty"><span className="actions-empty__icon"><UiIcon name="bolt" size={28} /></span><h3>{copy(locale, "Действий пока нет", "No actions yet")}</h3><p>{copy(locale, "CanvasTTY может найти команды проекта или вы можете описать намерение вручную.", "CanvasTTY can discover project commands, or you can describe an intention manually.")}</p><div><button type="button" onClick={discover}>{copy(locale, "Найти в проекте", "Discover in project")}</button><button type="button" onClick={beginCreate}>{copy(locale, "Создать вручную", "Create manually")}</button></div></section> : (
            <div className="actions-list">
              {visibleActions.map((action) => {
                const run = latestRunByAction.get(action.id) ?? null;
                const active = run ? isActive(run.status) : false;
                const expanded = expandedId === action.id;
                return <article className={`action-row ${expanded ? "action-row--expanded" : ""}`} key={action.id}>
                  <button className="action-row__main" type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : action.id)}>
                    <span className={`action-row__icon action-row__icon--${action.risk}`}><UiIcon name="bolt" size={17} /></span>
                    <span className="action-row__copy"><strong>{action.title}</strong><small>{action.description || action.command}</small></span>
                    <span className={`action-row__status action-row__status--${runTone(run)}`}>{runLabel(locale, run)}</span><UiIcon name="chevron" size={15} />
                  </button>
                  <div className="action-row__run-area">
                    {active && run && <button className="action-row__stop" type="button" disabled={busyId !== null} onClick={() => void perform(action.id, () => props.onStop(run.id))}>{copy(locale, "Стоп", "Stop")}</button>}
                    <button className="action-row__run" type="button" disabled={busyId !== null} onClick={() => requestRun(action)}>{busyId === action.id ? <UiIcon name="working" size={15} /> : <UiIcon name="arrow" size={15} />}{active && action.concurrency === "focus-existing" ? copy(locale, "Открыть", "Open") : copy(locale, "Запустить", "Run")}</button>
                  </div>
                  {expanded && <ActionDetails locale={locale} action={action} runs={runs.filter((item) => item.actionId === action.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 5)} busy={busyId !== null} removing={removingId === action.id} onEdit={() => beginEdit(action)} onAskRemove={() => setRemovingId(action.id)} onCancelRemove={() => setRemovingId(null)} onRemove={() => void perform(action.id, async () => { await props.onRemove(action.id); setRemovingId(null); })} onRetry={(runId, stepId) => action.risk === "dangerous" ? setApproval({ action, retry: { runId, stepId } }) : void perform(action.id, () => props.onRetry(runId, stepId))} />}
                </article>;
              })}
              {visibleActions.length === 0 && <p className="actions-list__empty">{copy(locale, "Ничего не найдено", "Nothing found")}</p>}
            </div>
          )}
        </div>
        {editor && <ActionEditor locale={locale} state={editor} busy={busyId === "editor"} onChange={setEditor} onChooseFolder={props.onChooseFolder} onCancel={() => setEditor(null)} onSave={() => void perform("editor", async () => { if (editor.id) await props.onUpdate(editor.id, editor.value); else await props.onCreate(editor.value); setEditor(null); })} />}
        {approval && <div className="action-approval" role="alertdialog" aria-modal="true"><div className="action-approval__card"><span className="action-approval__icon"><UiIcon name="attention" size={24} /></span><h3>{approval.token ? copy(locale, "Внешний запрос требует подтверждения", "External request needs approval") : copy(locale, "Проверьте опасное действие", "Review dangerous action")}</h3><p>{copy(locale, "Команда будет выполнена без изменений. Проверьте точную команду и папку.", "The command will run unchanged. Review the exact command and folder.")}</p><code>{approval.action.command}</code><small>{approval.action.cwd}</small><div><button type="button" onClick={() => setApproval(null)}>{copy(locale, "Отмена", "Cancel")}</button><button className="action-approval__run" type="button" onClick={() => { const pending = approval; setApproval(null); void perform(pending.action.id, () => pending.token ? props.onApprove(pending.token) : pending.retry ? props.onRetry(pending.retry.runId, pending.retry.stepId) : props.onRun(pending.action)); }}>{copy(locale, "Проверил, запустить", "Reviewed, run")}</button></div></div></div>}
        {discovery && <DiscoveryPreview locale={locale} result={discovery} selected={selectedImports} busy={busyId !== null} onToggle={(id) => setSelectedImports((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onClose={() => setDiscovery(null)} onImport={() => void perform("import", async () => { await props.onImport(discovery.actions.filter((item) => selectedImports.has(item.importId)).map((item) => item.input)); setDiscovery(null); })} />}
      </aside>
    </div>
  );
}

function ActionDetails({ locale, action, runs, busy, removing, onEdit, onAskRemove, onCancelRemove, onRemove, onRetry }: { locale: LocaleId; action: ProjectActionDefinition; runs: ActionRunSnapshot[]; busy: boolean; removing: boolean; onEdit(): void; onAskRemove(): void; onCancelRemove(): void; onRemove(): void; onRetry(runId: string, stepId?: string): void }): React.JSX.Element {
  return <div className="action-row__details"><div><span>{copy(locale, "Точная команда", "Exact command")}</span><code>{action.command}</code></div><div><span>{copy(locale, "Рабочая папка", "Working folder")}</span><code>{action.cwd}</code></div><div className="action-row__meta"><span>{action.risk}</span><span>{action.concurrency}</span><span>{copy(locale, "Агент", "Agent")}: {action.agentPolicy}</span>{action.source && <span>{action.source.kind}</span>}<span>{action.steps.length} {copy(locale, "шагов", "steps")}</span></div>{runs.length > 0 && <div className="action-runs"><span>{copy(locale, "Последние запуски", "Recent runs")}</span>{runs.map((run) => <article key={run.id}><header><strong>{runLabel(locale, run)}</strong><small>{new Date(run.startedAt).toLocaleTimeString(locale)}</small>{!isActive(run.status) && <button type="button" disabled={busy} onClick={() => onRetry(run.id)}>{copy(locale, "Повторить", "Retry")}</button>}</header><ol>{run.steps.map((step) => <li key={step.stepId} className={`action-step action-step--${step.status}`}><i /><span><strong>{step.title}</strong><small>{step.message || step.status}{step.exitCode !== null ? ` · exit ${step.exitCode}` : ""}</small></span>{(step.status === "failed" || step.status === "cancelled") && <button type="button" disabled={busy} onClick={() => onRetry(run.id, step.stepId)}>{copy(locale, "Повторить шаг", "Retry step")}</button>}</li>)}</ol></article>)}</div>}<div className="action-row__details-actions"><button type="button" onClick={onEdit}>{copy(locale, "Изменить", "Edit")}</button>{removing ? <><span>{copy(locale, "Удалить action?", "Remove action?")}</span><button className="action-row__delete" type="button" onClick={onRemove}>{copy(locale, "Удалить", "Remove")}</button><button type="button" onClick={onCancelRemove}>{copy(locale, "Отмена", "Cancel")}</button></> : <button type="button" onClick={onAskRemove}>{copy(locale, "Удалить", "Remove")}</button>}</div></div>;
}

function ActionEditor({ locale, state, busy, onChange, onChooseFolder, onCancel, onSave }: { locale: LocaleId; state: EditorState; busy: boolean; onChange(state: EditorState): void; onChooseFolder(defaultPath: string): Promise<string | null>; onCancel(): void; onSave(): void }): React.JSX.Element {
  const value = state.value;
  const update = (patch: Partial<ProjectActionInput>): void => onChange({ ...state, value: { ...value, ...patch } });
  const steps = value.steps ?? [];
  const valid = Boolean(value.title.trim() && value.command.trim() && value.cwd.trim() && steps.every(validStep));
  const updateStep = (index: number, patch: Partial<ProjectActionStepInput>): void => update({ steps: steps.map((step, candidate) => candidate === index ? { ...step, ...patch } : step) });
  return <div className="action-editor" role="dialog" aria-modal="true"><header><div><span>{state.id ? copy(locale, "Изменить action", "Edit action") : copy(locale, "Новый action", "New action")}</span><h3>{copy(locale, "Что должен сделать CanvasTTY?", "What should CanvasTTY do?")}</h3></div><button type="button" onClick={onCancel}><UiIcon name="close" size={18} /></button></header><div className="action-editor__fields">
    <label><span>{copy(locale, "Понятное намерение", "Clear intention")}</span><input autoFocus value={value.title} maxLength={80} onChange={(event) => update({ title: event.target.value })} placeholder={copy(locale, "Запустить окружение разработки", "Start development environment")} /></label>
    <label><span>{copy(locale, "Описание", "Description")}</span><input value={value.description} maxLength={240} onChange={(event) => update({ description: event.target.value })} /></label>
    <label><span>{copy(locale, "Основная команда", "Primary command")}</span><textarea value={value.command} maxLength={4096} onChange={(event) => update({ command: event.target.value })} placeholder="npm run dev" spellCheck={false} /></label>
    <label><span>{copy(locale, "Рабочая папка", "Working folder")}</span><div className="action-editor__folder"><input value={value.cwd} onChange={(event) => update({ cwd: event.target.value })} /><button type="button" onClick={() => void onChooseFolder(value.cwd).then((folder) => folder && update({ cwd: folder }))}><UiIcon name="folder" size={16} />{copy(locale, "Выбрать", "Choose")}</button></div></label>
    <fieldset><legend>{copy(locale, "Риск", "Risk")}</legend><div className="action-editor__choices">{(["safe", "write", "dangerous"] as const).map((risk) => <button className={value.risk === risk ? "action-editor__choice--active" : ""} type="button" key={risk} onClick={() => update({ risk })}><strong>{riskTitle(locale, risk)}</strong><small>{riskDescription(locale, risk)}</small></button>)}</div></fieldset>
    <fieldset><legend>{copy(locale, "Повторный запуск", "Repeated runs")}</legend><div className="action-editor__choices action-editor__choices--two">{(["focus-existing", "parallel"] as const).map((concurrency) => <button className={value.concurrency === concurrency ? "action-editor__choice--active" : ""} type="button" key={concurrency} onClick={() => update({ concurrency })}><strong>{concurrency === "focus-existing" ? copy(locale, "Один экземпляр", "Single instance") : copy(locale, "Параллельно", "Parallel")}</strong><small>{concurrency === "focus-existing" ? copy(locale, "Открывает уже работающий запуск", "Focuses an existing run") : copy(locale, "Всегда создаёт новый запуск", "Always creates a new run")}</small></button>)}</div></fieldset>
    <label><span>{copy(locale, "Доступ агента и плагинов", "Agent and plugin access")}</span><select value={value.agentPolicy ?? "ask"} onChange={(event) => update({ agentPolicy: event.target.value as ProjectActionInput["agentPolicy"] })}><option value="deny">{copy(locale, "Запретить", "Deny")}</option><option value="ask">{copy(locale, "Спрашивать", "Ask")}</option><option value="allow">{copy(locale, "Разрешить", "Allow")}</option></select><small>{copy(locale, "Агент вызывает action только по ID и не может подменить команду.", "Agents invoke actions by ID and cannot replace the command.")}</small></label>
    <fieldset className="action-step-editor"><legend>{copy(locale, "Шаги и проверки", "Steps and checks")}</legend><p>{copy(locale, "Добавьте сервисы, healthchecks и открытие preview. Зависимости задают порядок.", "Add services, health checks, and preview opening. Dependencies define order.")}</p>{steps.map((step, index) => <StepEditor key={step.id ?? index} locale={locale} step={step} index={index} prior={steps.slice(0, index)} onChange={(patch) => updateStep(index, patch)} onRemove={() => update({ steps: steps.filter((_, candidate) => candidate !== index) })} />)}<button type="button" onClick={() => update({ steps: [...steps, { id: `step-${steps.length + 1}`, title: `${copy(locale, "Шаг", "Step")} ${steps.length + 1}`, kind: "command", mode: "task", execution: "shell", command: "", cwd: value.cwd, dependsOn: steps.length ? [String(steps.at(-1)?.id ?? `step-${steps.length}`)] : [] }] })}><UiIcon name="plus" size={14} />{copy(locale, "Добавить шаг", "Add step")}</button></fieldset>
    <div className="action-editor__options"><label><input type="checkbox" checked={value.autoGroup === true} onChange={(event) => update({ autoGroup: event.target.checked })} />{copy(locale, "Объединять терминалы запуска в группу", "Group run terminals")}</label><label><input type="checkbox" checked={value.pinned === true} onChange={(event) => update({ pinned: event.target.checked })} />{copy(locale, "Закрепить action сверху", "Pin action first")}</label><label><span>{copy(locale, "Раскладка", "Layout")}</span><select value={value.autoArrange ?? "grid"} onChange={(event) => update({ autoArrange: event.target.value as ProjectActionInput["autoArrange"] })}><option value="grid">grid</option><option value="columns">columns</option><option value="rows">rows</option></select></label></div>
  </div><footer><button type="button" onClick={onCancel}>{copy(locale, "Отмена", "Cancel")}</button><button className="action-editor__save" type="button" disabled={!valid || busy} onClick={onSave}>{busy ? "…" : copy(locale, "Сохранить", "Save")}</button></footer></div>;
}

function StepEditor({ locale, step, index, prior, onChange, onRemove }: { locale: LocaleId; step: ProjectActionStepInput; index: number; prior: ProjectActionStepInput[]; onChange(patch: Partial<ProjectActionStepInput>): void; onRemove(): void }): React.JSX.Element {
  return <article className="action-step-editor__step"><header><strong>{index + 1}</strong><input value={step.title} onChange={(event) => onChange({ title: event.target.value })} /><select value={step.kind} onChange={(event) => onChange({ kind: event.target.value as ProjectActionStepInput["kind"] })}><option value="command">command</option><option value="http-health">HTTP health</option><option value="tcp-health">TCP health</option><option value="open-url">open URL</option></select><button type="button" onClick={onRemove}><UiIcon name="trash" size={14} /></button></header>{step.kind === "command" && <><textarea value={step.command ?? ""} onChange={(event) => onChange({ command: event.target.value })} placeholder="npm run dev" /><div><label><span>{copy(locale, "Режим", "Mode")}</span><select value={step.mode ?? "task"} onChange={(event) => onChange({ mode: event.target.value as ProjectActionStepInput["mode"] })}><option value="task">task</option><option value="service">service</option></select></label><label><span>cwd</span><input value={step.cwd ?? ""} onChange={(event) => onChange({ cwd: event.target.value })} /></label></div></>}{(step.kind === "http-health" || step.kind === "open-url") && <input value={step.url ?? ""} onChange={(event) => onChange({ url: event.target.value })} placeholder="http://localhost:3000/health" />}{step.kind === "tcp-health" && <div><input value={step.host ?? "localhost"} onChange={(event) => onChange({ host: event.target.value })} placeholder="localhost" /><input type="number" min={1} max={65535} value={step.port ?? ""} onChange={(event) => onChange({ port: Number(event.target.value) || null })} placeholder="5432" /></div>}<details><summary>{copy(locale, "Зависит от", "Depends on")}</summary>{prior.map((candidate, candidateIndex) => { const id = String(candidate.id ?? `step-${candidateIndex + 1}`); return <label key={id}><input type="checkbox" checked={(step.dependsOn ?? []).includes(id)} onChange={(event) => onChange({ dependsOn: event.target.checked ? [...(step.dependsOn ?? []), id] : (step.dependsOn ?? []).filter((item) => item !== id) })} />{candidate.title}</label>; })}{prior.length === 0 && <small>{copy(locale, "Первый шаг", "First step")}</small>}</details></article>;
}

function DiscoveryPreview({ locale, result, selected, busy, onToggle, onClose, onImport }: { locale: LocaleId; result: ActionDiscoveryResult; selected: Set<string>; busy: boolean; onToggle(id: string): void; onClose(): void; onImport(): void }): React.JSX.Element {
  return <div className="action-editor action-discovery" role="dialog" aria-modal="true"><header><div><span>{result.root}</span><h3>{copy(locale, "Найденные команды", "Discovered commands")}</h3></div><button type="button" onClick={onClose}><UiIcon name="close" size={18} /></button></header><div className="action-discovery__sources">{result.sources.map((source) => <span key={`${source.kind}:${source.path}`} className={source.error ? "action-discovery__source--error" : ""}>{source.kind} · {source.count}{source.error ? ` · ${source.error}` : ""}</span>)}</div><div className="action-discovery__list">{result.actions.map((item) => <label key={item.importId} className={!item.available ? "action-discovery__item--disabled" : ""}><input type="checkbox" disabled={!item.available} checked={selected.has(item.importId)} onChange={() => onToggle(item.importId)} /><span><strong>{item.input.title}</strong><code>{item.input.command}</code><small>{item.input.source?.kind} · {item.message ?? item.input.cwd}</small></span></label>)}{result.actions.length === 0 && <p>{copy(locale, "Поддерживаемые команды не найдены.", "No supported commands were found.")}</p>}</div><footer><button type="button" onClick={onClose}>{copy(locale, "Отмена", "Cancel")}</button><button className="action-editor__save" type="button" disabled={busy || selected.size === 0} onClick={onImport}>{copy(locale, "Импортировать выбранные", "Import selected")}</button></footer></div>;
}

function defaultAction(cwd: string): ProjectActionInput { return { title: "", description: "", command: "", cwd, risk: "safe", concurrency: "focus-existing", agentPolicy: "ask", steps: [], autoGroup: false, autoArrange: "grid", pinned: false }; }
function validStep(step: ProjectActionStepInput): boolean { if (!step.title.trim()) return false; if (step.kind === "command") return Boolean(step.command?.trim()); if (step.kind === "tcp-health") return Boolean(step.host && step.port); return Boolean(step.url); }
function isActive(status: ActionRunSnapshot["status"]): boolean { return status === "queued" || status === "running" || status === "ready" || status === "waiting-approval"; }
function runTone(run: ActionRunSnapshot | null): "never" | "running" | "done" | "failed" { if (!run) return "never"; if (isActive(run.status)) return "running"; return run.status === "succeeded" ? "done" : "failed"; }
function runLabel(locale: LocaleId, run: ActionRunSnapshot | null): string { if (!run) return copy(locale, "Ещё не запускалось", "Never run"); const labels: Record<ActionRunSnapshot["status"], [string, string]> = { "waiting-approval": ["Ждёт подтверждения", "Waiting approval"], queued: ["В очереди", "Queued"], running: ["Выполняется", "Running"], ready: ["Готово к работе", "Ready"], succeeded: ["Завершено", "Succeeded"], failed: ["Ошибка", "Failed"], cancelled: ["Остановлено", "Cancelled"] }; return copy(locale, ...labels[run.status]); }
function riskTitle(locale: LocaleId, risk: ProjectActionInput["risk"]): string { return risk === "safe" ? copy(locale, "Только чтение", "Read only") : risk === "write" ? copy(locale, "Меняет проект", "Changes project") : copy(locale, "Опасное", "Dangerous"); }
function riskDescription(locale: LocaleId, risk: ProjectActionInput["risk"]): string { return risk === "safe" ? copy(locale, "Проверки, логи, status", "Checks, logs, status") : risk === "write" ? copy(locale, "Сборка и генерация файлов", "Builds and generated files") : copy(locale, "Удаление, reset или deploy", "Deletion, reset, or deploy"); }
function copy(locale: LocaleId, ru: string, en: string): string { return locale === "ru" ? ru : en; }
