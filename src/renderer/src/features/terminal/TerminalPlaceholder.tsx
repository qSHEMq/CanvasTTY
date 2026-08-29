import { useEffect, useRef, useState } from "react";
import type {
  LocaleId,
  Point,
  SessionBounds,
  WorkspaceTerminal
} from "../../../../shared/contracts";
import { ProviderIcon } from "../../components/ProviderIcon";
import { UiIcon } from "../../components/UiIcon";
import { t } from "../../lib/i18n";
import {
  constrainResize,
  snapMove,
  snapResize,
  type ResizeDirection
} from "../workspace/snap";

interface TerminalPlaceholderProps {
  terminal: WorkspaceTerminal;
  locale: LocaleId;
  zoom: number;
  snapEnabled: boolean;
  snapTargets: readonly SessionBounds[];
  onBoundsChange(id: string, bounds: SessionBounds): Promise<void>;
  onStart(id: string): Promise<void>;
  onRemove(id: string): Promise<void>;
}

interface DragState {
  pointerId: number;
  startClient: Point;
  startBounds: SessionBounds;
}

interface ResizeState extends DragState {
  direction: ResizeDirection;
}

const RESIZE_DIRECTIONS: ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

export function TerminalPlaceholder({
  terminal,
  locale,
  zoom,
  snapEnabled,
  snapTargets,
  onBoundsChange,
  onStart,
  onRemove
}: TerminalPlaceholderProps): React.JSX.Element {
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const liveBounds = useRef<SessionBounds>({ position: terminal.position, size: terminal.size });
  const [position, setPosition] = useState(terminal.position);
  const [size, setSize] = useState(terminal.size);
  const [starting, setStarting] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const summaryMode = zoom < 0.5;
  const summaryScale = summaryMode ? Math.min(2.5, Math.max(1, 0.5 / zoom)) : 1;

  useEffect(() => {
    const bounds = { position: terminal.position, size: terminal.size };
    liveBounds.current = bounds;
    setPosition(bounds.position);
    setSize(bounds.size);
  }, [terminal.position, terminal.size]);

  const applyBounds = (bounds: SessionBounds): void => {
    liveBounds.current = bounds;
    setPosition(bounds.position);
    setSize(bounds.size);
  };

  const startDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startBounds: liveBounds.current
    };
  };

  const drag = (event: React.PointerEvent<HTMLElement>): void => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const rawPosition = {
      x: state.startBounds.position.x + (event.clientX - state.startClient.x) / zoom,
      y: state.startBounds.position.y + (event.clientY - state.startClient.y) / zoom
    };
    applyBounds({
      position: snapEnabled ? snapMove(rawPosition, state.startBounds.size, snapTargets) : rawPosition,
      size: state.startBounds.size
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>): void => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    void onBoundsChange(terminal.id, liveBounds.current);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, direction: ResizeDirection): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeState.current = {
      pointerId: event.pointerId,
      direction,
      startClient: { x: event.clientX, y: event.clientY },
      startBounds: liveBounds.current
    };
  };

  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = (event.clientX - state.startClient.x) / zoom;
    const deltaY = (event.clientY - state.startClient.y) / zoom;
    const raw: SessionBounds = {
      position: {
        x: state.startBounds.position.x + (state.direction.includes("w") ? deltaX : 0),
        y: state.startBounds.position.y + (state.direction.includes("n") ? deltaY : 0)
      },
      size: {
        width: state.startBounds.size.width
          + (state.direction.includes("e") ? deltaX : 0)
          - (state.direction.includes("w") ? deltaX : 0),
        height: state.startBounds.size.height
          + (state.direction.includes("s") ? deltaY : 0)
          - (state.direction.includes("n") ? deltaY : 0)
      }
    };
    const constrained = constrainResize(raw, state.direction);
    applyBounds(snapEnabled ? snapResize(constrained, state.direction, snapTargets) : constrained);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeState.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    resizeState.current = null;
    void onBoundsChange(terminal.id, liveBounds.current);
  };

  const start = async (): Promise<void> => {
    if (starting) return;
    setStarting(true);
    try {
      await onStart(terminal.id);
    } finally {
      setStarting(false);
    }
  };

  return (
    <article
      className={`terminal-card terminal-placeholder ${summaryMode ? "terminal-card--summary" : ""}`}
      data-interactive="true"
      style={{
        width: size.width,
        height: size.height,
        transform: `translate(${position.x}px, ${position.y}px)`,
        "--summary-scale": summaryScale,
        "--summary-content-width": `${Math.max(0, (size.width - 72) / summaryScale)}px`
      } as React.CSSProperties}
    >
      <header
        className="terminal-card__header"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="terminal-card__identity">
          <ProviderIcon provider={terminal.provider} size="small" />
          <strong>{terminal.titleCustomized ? terminal.title : compactPath(terminal.cwd)}</strong>
        </div>
        <div className="terminal-card__actions">
          <button
            className="terminal-card__action"
            type="button"
            disabled={starting}
            onClick={() => void start()}
            title={t(locale, "startSavedTerminal")}
            aria-label={t(locale, "startSavedTerminal")}
          >
            <UiIcon name={starting ? "working" : "arrow"} size={15} />
          </button>
          <button
            className="terminal-card__action terminal-card__action--close"
            type="button"
            onClick={() => setConfirmingRemove(true)}
            title={t(locale, "removeSavedTerminal")}
            aria-label={t(locale, "removeSavedTerminal")}
          >
            <UiIcon name="close" size={15} />
          </button>
        </div>
      </header>

      <section className="terminal-placeholder__surface">
        <ProviderIcon provider={terminal.provider} size="large" />
        <strong>{t(locale, "terminalNotRunning")}</strong>
        <span>{compactPath(terminal.cwd)}</span>
        <button type="button" disabled={starting} onClick={() => void start()}>
          {starting ? t(locale, "startingSavedTerminal") : t(locale, "startSavedTerminal")}
        </button>
      </section>

      <button
        className="terminal-card__summary"
        type="button"
        onClick={() => void start()}
        disabled={starting}
      >
        <span className="terminal-card__summary-content">
          <ProviderIcon provider={terminal.provider} size="large" />
          <span className="terminal-card__summary-copy">
            <strong>{terminal.title}</strong>
            <span>{t(locale, "terminalNotRunning")}</span>
          </span>
        </span>
      </button>

      {confirmingRemove && (
        <div className="terminal-placeholder__confirm" role="alertdialog" aria-modal="true">
          <strong>{t(locale, "removeSavedTerminalQuestion")}</strong>
          <div>
            <button type="button" onClick={() => setConfirmingRemove(false)}>{t(locale, "cancel")}</button>
            <button
              className="terminal-placeholder__remove"
              type="button"
              onClick={() => void onRemove(terminal.id)}
            >{t(locale, "removeSavedTerminal")}</button>
          </div>
        </div>
      )}

      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          className={`terminal-card__resize-handle terminal-card__resize-handle--${direction}`}
          key={direction}
          onPointerDown={(event) => startResize(event, direction)}
          onPointerMove={resize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ))}
    </article>
  );
}

function compactPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
