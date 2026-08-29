import { useEffect, useMemo, useRef, useState } from "react";
import type { LocaleId } from "../../../../shared/contracts";
import { UiIcon } from "../../components/UiIcon";

export interface PaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  keywords?: string[];
  run(): void;
}

interface CommandPaletteProps {
  open: boolean;
  locale: LocaleId;
  commands: PaletteCommand[];
  onClose(): void;
}

export function CommandPalette({ open, locale, commands, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return commands.slice(0, 30);
    return commands
      .map((command) => ({ command, score: score(command, needle, locale) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 30)
      .map((candidate) => candidate.command);
  }, [commands, locale, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => input.current?.focus(), 0);
  }, [open]);
  useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, visible.length - 1))), [visible.length]);

  if (!open) return null;
  const execute = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    onClose();
    command.run();
  };
  return (
    <div className="command-palette" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={copy(locale, "Палитра команд", "Command palette")}>
        <label>
          <UiIcon name="bolt" size={18} />
          <input
            ref={input}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            placeholder={copy(locale, "Введите действие…", "Type a command…")}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); onClose(); }
              else if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(visible.length - 1, current + 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
              else if (event.key === "Enter") { event.preventDefault(); execute(visible[activeIndex]); }
            }}
          />
          <kbd>{window.canvasTTY.window.isMacOS ? "⌘⇧P" : "Ctrl+Shift+P"}</kbd>
        </label>
        <div className="command-palette__results" role="listbox">
          {visible.map((command, index) => (
            <button
              key={command.id}
              className={index === activeIndex ? "command-palette__item--active" : ""}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => execute(command)}
            >
              <span><strong>{command.title}</strong>{command.subtitle && <small>{command.subtitle}</small>}</span>
              <em>{command.group}</em>
            </button>
          ))}
          {visible.length === 0 && <p>{copy(locale, "Команд не найдено", "No commands found")}</p>}
        </div>
      </section>
    </div>
  );
}

function score(command: PaletteCommand, needle: string, locale: LocaleId): number {
  const title = command.title.toLocaleLowerCase(locale);
  const haystack = [title, command.subtitle, command.group, ...(command.keywords ?? [])].filter(Boolean).join(" ").toLocaleLowerCase(locale);
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (title.includes(needle)) return 60;
  return haystack.includes(needle) ? 30 : 0;
}

function copy(locale: LocaleId, ru: string, en: string): string {
  return locale === "ru" ? ru : en;
}
