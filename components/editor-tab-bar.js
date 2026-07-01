"use client";

import { SECTIONS } from "@/lib/editor-format";

export function EditorTabBar({ activeSection, onSelectSection }) {
  return (
    <div className="panel-tabs flex flex-none flex-col gap-1.5 border-b border-[var(--border)] px-4 pb-2.5 pt-2 lg:px-3 lg:py-3">
      <div className="no-scrollbar flex flex-wrap items-center gap-1.5">
        {SECTIONS.map((section) => {
          const selected = section.id === activeSection;

          return (
            <button
              className={`section-tab rounded-full px-3 py-1.5 text-[11px] font-semibold transition lg:px-3.5 lg:text-xs ${
                selected
                  ? "active-tab bg-[var(--accent)] text-[var(--on-accent)]"
                  : "tab-link text-[var(--muted)] hover:bg-[var(--surface-hover)]"
              }`}
              aria-selected={selected}
              key={section.id}
              onClick={() => onSelectSection(section.id)}
              role="tab"
              type="button"
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
