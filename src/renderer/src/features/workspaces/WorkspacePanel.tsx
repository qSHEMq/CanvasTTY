import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CameraState,
  LocaleId,
  Point,
  TerminalTemplateInput,
  WorkspaceArrangeMode,
  WorkspaceCatalogSnapshot,
  WorkspaceDocument,
  WorkspaceGroupInput,
  WorkspaceGroupUpdate,
  WorkspacePresetInput,
  WorkspaceSavedViewInput
} from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";

interface WorkspacePanelProps {
  open: boolean;
  locale: LocaleId;
  workspace: WorkspaceDocument;
  catalog: WorkspaceCatalogSnapshot;
  camera: CameraState;
  defaultCwd: string;
  onClose(): void;
  onSetProjectRoot(path: string): Promise<void>;
  onChooseFolder(defaultPath: string): Promise<string | null>;
  onCreateGroup(input: WorkspaceGroupInput): Promise<void>;
  onUpdateGroup(input: WorkspaceGroupUpdate): Promise<void>;
  onRemoveGroup(id: string, removeMembers?: boolean): Promise<void>;
  onArrange(mode: WorkspaceArrangeMode, objectIds?: string[]): Promise<void>;
  onSaveView(input: WorkspaceSavedViewInput): Promise<void>;
  onRemoveView(id: string): Promise<void>;
  onApplyView(camera: CameraState): void;
  onCreateTemplate(input: TerminalTemplateInput): Promise<void>;
  onRemoveTemplate(id: string): Promise<void>;
  onRunTemplate(id: string): Promise<void>;
  onSavePreset(input: WorkspacePresetInput): Promise<void>;
  onRemovePreset(id: string): Promise<void>;
  onCreateFromPreset(title: string, projectRoot: string, presetId: string): Promise<void>;
  onExport(): Promise<string>;
  onImport(raw: string): Promise<void>;
}

type Tab = "layout" | "templates" | "transfer";

export function WorkspacePanel(props: WorkspacePanelProps): React.JSX.Element {
  const { open, locale, workspace, catalog, camera, defaultCwd, onClose } = props;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>("layout");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rootDraft, setRootDraft] = useState(workspace.projectRoot);
  const [viewTitle, setViewTitle] = useState("");
  const [template, setTemplate] = useState({ title: "", cwd: workspace.projectRoot || defaultCwd, command: "" });
  const [presetTitle, setPresetTitle] = useState("");
  const [transfer, setTransfer] = useState("");

  useEffect(() => setRootDraft(workspace.projectRoot), [workspace.projectRoot]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose, open]);

  const objects = useMemo(() => [
    ...workspace.terminals.map((terminal) => ({ id: terminal.id, title: terminal.title, kind: copy(locale, "Терминал", "Terminal") })),
    ...workspace.pluginCanvas.map((plugin) => ({ id: plugin.id, title: plugin.title, kind: copy(locale, "Плагин", "Plugin") })),
    ...(workspace.browserCanvas ? [{ id: "browser", title: copy(locale, "Браузер", "Browser"), kind: copy(locale, "Браузер", "Browser") }] : [])
  ], [locale, workspace.browserCanvas, workspace.pluginCanvas, workspace.terminals]);

  const perform = async (task: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await task(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : copy(locale, "Не удалось сохранить", "Could not save")); }
    finally { setBusy(false); }
  };

  return (
    <div className={`workspace-panel-backdrop ${open ? "workspace-panel-backdrop--open" : ""}`} aria-hidden={!open} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className={`workspace-panel ${open ? "workspace-panel--open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="workspace-panel-title">
        <header><div><span>{workspace.title}</span><h2 id="workspace-panel-title">{copy(locale, "Workspace", "Workspace")}</h2></div><button ref={closeButton} type="button" onClick={onClose}><UiIcon name="close" size={18} /></button></header>
        <nav aria-label={copy(locale, "Разделы workspace", "Workspace sections")}>
          {(["layout", "templates", "transfer"] as Tab[]).map((item) => <button key={item} className={tab === item ? "workspace-panel__tab--active" : ""} type="button" onClick={() => setTab(item)}>{tabTitle(locale, item)}</button>)}
        </nav>
        {error && <p className="workspace-panel__error" role="alert">{error}</p>}
        <div className="workspace-panel__content">
          {tab === "layout" && (
            <>
              <PanelSection title={copy(locale, "Папка проекта", "Project folder")} description={copy(locale, "Используется для поиска actions и как cwd по умолчанию.", "Used for action discovery and as the default working folder.")}>
                <div className="workspace-panel__inline"><input value={rootDraft} onChange={(event) => setRootDraft(event.target.value)} placeholder={defaultCwd} /><button type="button" onClick={() => void props.onChooseFolder(rootDraft || defaultCwd).then((path) => path && setRootDraft(path))}><UiIcon name="folder" size={15} /></button><button type="button" disabled={busy || rootDraft === workspace.projectRoot} onClick={() => void perform(() => props.onSetProjectRoot(rootDraft))}>{copy(locale, "Сохранить", "Save")}</button></div>
              </PanelSection>
              <PanelSection title={copy(locale, "Автораскладка", "Auto-arrange")} description={copy(locale, "Расставляет карточки без изменения их команд и процессов.", "Places cards without changing their commands or processes.")}>
                <div className="workspace-panel__button-row">{(["grid", "columns", "rows"] as WorkspaceArrangeMode[]).map((mode) => <button type="button" key={mode} disabled={busy} onClick={() => void perform(() => props.onArrange(mode))}>{arrangeTitle(locale, mode)}</button>)}</div>
              </PanelSection>
              <PanelSection title={copy(locale, "Группы", "Groups")} description={copy(locale, "Рамки двигают связанные карточки вместе; группу можно свернуть или заблокировать.", "Frames move related cards together and can be collapsed or locked.")} action={<button type="button" disabled={busy} onClick={() => void perform(() => props.onCreateGroup(newGroupInput(locale, workspace.groups.length, [])))}><UiIcon name="plus" size={14} />{copy(locale, "Группа", "Group")}</button>}>
                <div className="workspace-panel__groups">
                  {workspace.groups.map((group) => <GroupEditor key={group.id} locale={locale} group={group} objects={objects} busy={busy} onUpdate={(patch) => perform(() => props.onUpdateGroup({ id: group.id, ...patch }))} onRemove={() => perform(() => props.onRemoveGroup(group.id))} />)}
                  {workspace.groups.length === 0 && <Empty>{copy(locale, "Создайте рамку и выберите карточки, которые должны двигаться вместе.", "Create a frame and choose cards that should move together.")}</Empty>}
                </div>
              </PanelSection>
              <PanelSection title={copy(locale, "Сохранённые виды", "Saved views")} description={copy(locale, "Запоминают позицию и масштаб камеры.", "Remember camera position and zoom.")}>
                <div className="workspace-panel__inline"><input value={viewTitle} onChange={(event) => setViewTitle(event.target.value)} placeholder={copy(locale, "Например: Backend", "For example: Backend")} /><button type="button" disabled={busy || !viewTitle.trim()} onClick={() => void perform(async () => { await props.onSaveView({ title: viewTitle, camera }); setViewTitle(""); })}>{copy(locale, "Сохранить вид", "Save view")}</button></div>
                <div className="workspace-panel__list">{workspace.savedViews.map((view) => <div key={view.id}><button type="button" onClick={() => props.onApplyView(view.camera)}><strong>{view.title}</strong><small>{Math.round(view.camera.zoom * 100)}%</small></button><button type="button" onClick={() => void perform(() => props.onRemoveView(view.id))}><UiIcon name="trash" size={14} /></button></div>)}</div>
              </PanelSection>
            </>
          )}
          {tab === "templates" && (
            <>
              <PanelSection title={copy(locale, "Новый шаблон терминала", "New terminal template")} description={copy(locale, "Одинаковый терминал с правильной папкой и необязательной стартовой командой.", "A repeatable terminal with the correct folder and optional startup command.")}>
                <div className="workspace-panel__form"><input value={template.title} onChange={(event) => setTemplate((current) => ({ ...current, title: event.target.value }))} placeholder={copy(locale, "Название", "Name")} /><input value={template.cwd} onChange={(event) => setTemplate((current) => ({ ...current, cwd: event.target.value }))} placeholder={copy(locale, "Рабочая папка", "Working folder")} /><textarea value={template.command} onChange={(event) => setTemplate((current) => ({ ...current, command: event.target.value }))} placeholder={copy(locale, "Команда после запуска (необязательно)", "Command after launch (optional)")} /><button type="button" disabled={busy || !template.title.trim() || !template.cwd.trim()} onClick={() => void perform(async () => { await props.onCreateTemplate({ title: template.title, cwd: template.cwd, command: template.command || null, provider: "terminal", profile: "normal" }); setTemplate((current) => ({ ...current, title: "", command: "" })); })}>{copy(locale, "Создать шаблон", "Create template")}</button></div>
              </PanelSection>
              <PanelSection title={copy(locale, "Шаблоны", "Templates")}>
                <div className="workspace-panel__cards">{workspace.templates.map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{item.cwd}</small>{item.command && <code>{item.command}</code>}</span><div><button type="button" onClick={() => void perform(() => props.onRunTemplate(item.id))}><UiIcon name="arrow" size={14} />{copy(locale, "Запустить", "Run")}</button><button type="button" onClick={() => void perform(() => props.onRemoveTemplate(item.id))}><UiIcon name="trash" size={14} /></button></div></article>)}{workspace.templates.length === 0 && <Empty>{copy(locale, "Шаблонов пока нет.", "No templates yet.")}</Empty>}</div>
              </PanelSection>
            </>
          )}
          {tab === "transfer" && (
            <>
              <PanelSection title={copy(locale, "Preset", "Preset")} description={copy(locale, "Сохраняет группы, actions и терминальные шаблоны как основу для нового workspace.", "Saves groups, actions, and terminal templates as a base for a new workspace.")}>
                <div className="workspace-panel__inline"><input value={presetTitle} onChange={(event) => setPresetTitle(event.target.value)} placeholder={copy(locale, "Название preset", "Preset name")} /><button type="button" disabled={busy || !presetTitle.trim()} onClick={() => void perform(async () => { await props.onSavePreset({ title: presetTitle, description: workspace.title }); setPresetTitle(""); })}>{copy(locale, "Сохранить", "Save")}</button></div>
                <div className="workspace-panel__cards">{catalog.presets.map((preset) => <article key={preset.id}><span><strong>{preset.title}</strong><small>{preset.description}</small></span><div><button type="button" onClick={() => void perform(() => props.onCreateFromPreset(`${preset.title} workspace`, workspace.projectRoot, preset.id))}>{copy(locale, "Создать", "Create")}</button><button type="button" onClick={() => void perform(() => props.onRemovePreset(preset.id))}><UiIcon name="trash" size={14} /></button></div></article>)}</div>
              </PanelSection>
              <PanelSection title={copy(locale, "Экспорт и импорт", "Export and import")} description={copy(locale, "JSON не содержит живые процессы, browser tabs или plugin runtime.", "JSON does not include live processes, browser tabs, or plugin runtime.")}>
                <div className="workspace-panel__form"><textarea className="workspace-panel__transfer" value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder={copy(locale, "Здесь появится JSON…", "Workspace JSON appears here…")} /><div className="workspace-panel__button-row"><button type="button" disabled={busy} onClick={() => void perform(async () => setTransfer(await props.onExport()))}>{copy(locale, "Экспортировать", "Export")}</button><button type="button" disabled={!transfer.trim()} onClick={() => window.canvasTTY.clipboard.writeText(transfer)}><UiIcon name="copy" size={14} />{copy(locale, "Копировать", "Copy")}</button><button type="button" disabled={busy || !transfer.trim()} onClick={() => void perform(() => props.onImport(transfer))}>{copy(locale, "Импортировать как новый", "Import as new")}</button></div></div>
              </PanelSection>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function PanelSection({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <section className="workspace-panel__section"><header><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="workspace-panel__empty">{children}</p>;
}

function GroupEditor({ locale, group, objects, busy, onUpdate, onRemove }: {
  locale: LocaleId;
  group: WorkspaceDocument["groups"][number];
  objects: Array<{ id: string; title: string; kind: string }>;
  busy: boolean;
  onUpdate(patch: Omit<WorkspaceGroupUpdate, "id">): Promise<void>;
  onRemove(): Promise<void>;
}): React.JSX.Element {
  return <article className="workspace-group-editor"><div><input value={group.title} onChange={(event) => void onUpdate({ title: event.target.value })} /><select value={group.color} onChange={(event) => void onUpdate({ color: event.target.value as WorkspaceGroupUpdate["color"] })}>{["sage", "lilac", "blue", "sand", "rose", "slate"].map((color) => <option key={color} value={color}>{color}</option>)}</select><label><input type="checkbox" checked={group.collapsed} onChange={(event) => void onUpdate({ collapsed: event.target.checked })} />{copy(locale, "Свернуть", "Collapse")}</label><label><input type="checkbox" checked={group.locked} onChange={(event) => void onUpdate({ locked: event.target.checked })} />{copy(locale, "Закрепить", "Lock")}</label><button type="button" disabled={busy} onClick={() => void onRemove()}><UiIcon name="trash" size={14} /></button></div><details><summary>{copy(locale, "Карточки", "Cards")} · {group.memberIds.length}</summary>{objects.map((object) => <label key={object.id}><input type="checkbox" checked={group.memberIds.includes(object.id)} onChange={(event) => void onUpdate({ memberIds: event.target.checked ? [...group.memberIds, object.id] : group.memberIds.filter((id) => id !== object.id) })} /><span><strong>{object.title}</strong><small>{object.kind}</small></span></label>)}</details></article>;
}

function newGroupInput(locale: LocaleId, index: number, memberIds: string[]): WorkspaceGroupInput {
  const position: Point = { x: 40 + index * 36, y: 40 + index * 36 };
  return { title: `${copy(locale, "Группа", "Group")} ${index + 1}`, color: "sage", position, size: { width: 780, height: 520 }, memberIds };
}

function tabTitle(locale: LocaleId, tab: Tab): string {
  if (tab === "layout") return copy(locale, "Раскладка", "Layout");
  if (tab === "templates") return copy(locale, "Шаблоны", "Templates");
  return copy(locale, "Presets и перенос", "Presets & transfer");
}

function arrangeTitle(locale: LocaleId, mode: WorkspaceArrangeMode): string {
  if (mode === "grid") return copy(locale, "Сетка", "Grid");
  if (mode === "columns") return copy(locale, "Колонка", "Column");
  return copy(locale, "Строка", "Row");
}

function copy(locale: LocaleId, ru: string, en: string): string {
  return locale === "ru" ? ru : en;
}
