"use client";
import { updateSettings, useSettings } from "@/lib/settings";
import { usePreloadState } from "@/lib/preloader";

export function SettingsPanel() {
  const s = useSettings();
  const pre = usePreloadState();
  return (
    <details className="group relative" data-testid="settings">
      <summary className="cursor-pointer list-none rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800" title="Settings">
        ⚙<span className="ml-1 hidden sm:inline">Settings</span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-64 space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm shadow-xl">
        <label className="flex items-center justify-between gap-2">
          <span className="text-zinc-300">Engine depth</span>
          <select
            value={s.depth}
            onChange={(e) => updateSettings({ depth: Number(e.target.value) })}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
            data-testid="depth-select"
          >
            {[10, 12, 14, 16, 18].map((d) => (
              <option key={d} value={d}>
                {d}
                {d === 14 ? " (default)" : d >= 16 ? " (slower)" : " (fast)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2" title="Also compute the engine's 2nd-best line (MultiPV 2). Roughly 2-3x slower.">
          <span className="text-zinc-300">2nd-best engine line</span>
          <input type="checkbox" checked={s.multiPv === 2} onChange={(e) => updateSettings({ multiPv: e.target.checked ? 2 : 1 })} />
        </label>
        <label className="flex items-start justify-between gap-2">
          <span className="text-zinc-300">
            Preload newest games
            <span className="block text-xs text-zinc-500">
              Analyzes your 3 newest games in the background when the tab is idle (phones: only while charging).
            </span>
          </span>
          <input type="checkbox" checked={s.preload} onChange={(e) => updateSettings({ preload: e.target.checked })} data-testid="preload-toggle" />
        </label>
        {s.preload && pre.blockedReason && <p className="text-xs text-zinc-500">Preloading paused: {pre.blockedReason}.</p>}
      </div>
    </details>
  );
}
