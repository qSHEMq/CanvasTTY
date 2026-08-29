import { useRef, useState } from "react";
import type { LocaleId, Point, WorkspaceGroup, WorkspaceGroupUpdate } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";

interface GroupFrameProps {
  group: WorkspaceGroup;
  locale: LocaleId;
  zoom: number;
  onMove(id: string, position: Point): Promise<void>;
  onUpdate(input: WorkspaceGroupUpdate): Promise<void>;
}

export function GroupFrame({ group, locale, zoom, onMove, onUpdate }: GroupFrameProps): React.JSX.Element {
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const commit = async (patch: WorkspaceGroupUpdate): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await onUpdate(patch); } finally { setBusy(false); }
  };
  return (
    <section
      className={`workspace-group workspace-group--${group.color} ${group.collapsed ? "workspace-group--collapsed" : ""} ${group.locked ? "workspace-group--locked" : ""}`}
      style={{ left: group.position.x, top: group.position.y, width: group.size.width, height: group.collapsed ? 54 : group.size.height, transform: `translate(${offset.x}px, ${offset.y}px)` }}
      data-interactive="true"
    >
      <header
        onPointerDown={(event) => {
          if (group.locked || (event.target as HTMLElement).closest("button")) return;
          event.stopPropagation();
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          setOffset({ x: (event.clientX - drag.current.x) / zoom, y: (event.clientY - drag.current.y) / zoom });
        }}
        onPointerUp={(event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          const next = { x: group.position.x + offset.x, y: group.position.y + offset.y };
          drag.current = null;
          setOffset({ x: 0, y: 0 });
          void onMove(group.id, next);
        }}
        onPointerCancel={() => { drag.current = null; setOffset({ x: 0, y: 0 }); }}
      >
        <span><strong>{group.title}</strong><small>{group.memberIds.length} {copy(locale, "карточек", "cards")}</small></span>
        <div>
          <button type="button" disabled={busy} title={group.locked ? copy(locale, "Открепить", "Unlock") : copy(locale, "Закрепить", "Lock")} onClick={() => void commit({ id: group.id, locked: !group.locked })}><UiIcon name={group.locked ? "done" : "focus"} size={14} /></button>
          <button type="button" disabled={busy} title={group.collapsed ? copy(locale, "Развернуть", "Expand") : copy(locale, "Свернуть", "Collapse")} onClick={() => void commit({ id: group.id, collapsed: !group.collapsed })}><UiIcon name="chevron" size={14} /></button>
        </div>
      </header>
    </section>
  );
}

function copy(locale: LocaleId, ru: string, en: string): string {
  return locale === "ru" ? ru : en;
}
