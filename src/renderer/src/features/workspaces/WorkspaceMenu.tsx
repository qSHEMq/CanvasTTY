import { useEffect, useRef, useState } from "react";
import type { LocaleId, WorkspaceCatalogSnapshot } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";

interface WorkspaceMenuProps {
  locale: LocaleId;
  catalog: WorkspaceCatalogSnapshot;
  activeId: string;
  liveCounts: Record<string, number>;
  onRename(title: string): Promise<void>;
  onSwitch(id: string): Promise<void>;
  onCreate(title: string, projectRoot: string, presetId?: string): Promise<void>;
  onDuplicate(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  onOpenManager(): void;
}

export function WorkspaceMenu({
  locale, catalog, activeId, liveCounts, onRename, onSwitch, onCreate, onDuplicate, onDelete, onOpenManager
}: WorkspaceMenuProps): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = catalog.workspaces.find((workspace) => workspace.id === activeId) ?? catalog.workspaces[0];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "rename" | "create">("list");
  const [draft, setDraft] = useState(active?.title ?? "Workspace");
  const [projectRoot, setProjectRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "rename") setDraft(active?.title ?? "Workspace");
  }, [active?.title, mode]);
  useEffect(() => {
    if (!open) return;
    if (mode !== "list") {
      input.current?.focus();
      input.current?.select();
    }
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (mode !== "list") setMode("list");
      else setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [mode, open]);

  const perform = async (task: () => Promise<void>): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await task();
      setMode("list");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy(locale, "Не удалось изменить workspace", "Could not update workspace"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={root} className="workspace-menu">
      <button
        className="workspace-menu__trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setMode("list");
          setOpen((current) => !current);
        }}
      >
        <span>{active?.title ?? "Workspace"}</span>
        {(liveCounts[activeId] ?? 0) > 0 && <i>{liveCounts[activeId]}</i>}
        <UiIcon name="chevron" size={13} />
      </button>
      {open && (
        <div className="workspace-menu__popover workspace-switcher" role="dialog" aria-label={copy(locale, "Рабочие пространства", "Workspaces")}>
          {mode === "list" ? (
            <>
              <header><span>{copy(locale, "Рабочие пространства", "Workspaces")}</span><button type="button" onClick={() => { setDraft(copy(locale, "Новый workspace", "New workspace")); setProjectRoot(""); setMode("create"); }}><UiIcon name="plus" size={14} /></button></header>
              <div className="workspace-switcher__list">
                {catalog.workspaces.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === activeId ? "workspace-switcher__item--active" : ""}
                    type="button"
                    disabled={saving}
                    onClick={() => item.id !== activeId && void perform(() => onSwitch(item.id))}
                  >
                    <span><strong>{item.title}</strong><small>{item.projectRoot || copy(locale, "Без папки проекта", "No project folder")}</small></span>
                    <em>{liveCounts[item.id] ? `${liveCounts[item.id]} live` : item.objectCount}</em>
                  </button>
                ))}
              </div>
              {error && <p role="alert">{error}</p>}
              <div className="workspace-switcher__actions">
                <button type="button" onClick={() => setMode("rename")}>{copy(locale, "Переименовать", "Rename")}</button>
                <button type="button" disabled={saving} onClick={() => void perform(() => onDuplicate(activeId))}>{copy(locale, "Дублировать", "Duplicate")}</button>
                <button type="button" onClick={() => { setOpen(false); onOpenManager(); }}>{copy(locale, "Настроить", "Manage")}</button>
                <button
                  className="workspace-switcher__delete"
                  type="button"
                  disabled={saving || catalog.workspaces.length < 2}
                  title={catalog.workspaces.length < 2 ? copy(locale, "Нельзя удалить последний workspace", "The last workspace cannot be deleted") : undefined}
                  onClick={() => window.confirm(copy(locale, "Удалить этот workspace? Запущенные процессы должны быть остановлены.", "Delete this workspace? Running processes must be stopped.")) && void perform(() => onDelete(activeId))}
                ><UiIcon name="trash" size={14} /></button>
              </div>
            </>
          ) : (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim()) return;
              void perform(() => mode === "rename" ? onRename(draft) : onCreate(draft, projectRoot));
            }}>
              <span>{mode === "rename" ? copy(locale, "Переименовать workspace", "Rename workspace") : copy(locale, "Новый workspace", "New workspace")}</span>
              <label><span>{copy(locale, "Название", "Name")}</span><input ref={input} value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} /></label>
              {mode === "create" && <label><span>{copy(locale, "Папка проекта (необязательно)", "Project folder (optional)")}</span><input value={projectRoot} maxLength={4096} onChange={(event) => setProjectRoot(event.target.value)} /></label>}
              {error && <p role="alert">{error}</p>}
              <div><button type="button" onClick={() => setMode("list")}>{copy(locale, "Назад", "Back")}</button><button type="submit" disabled={saving || !draft.trim()}>{saving ? "…" : copy(locale, "Сохранить", "Save")}</button></div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function copy(locale: LocaleId, ru: string, en: string): string {
  return locale === "ru" ? ru : en;
}
