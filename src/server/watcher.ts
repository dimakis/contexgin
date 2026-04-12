import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContexGinServer } from './app.js';
import type { ServerConfig } from './types.js';

export interface Watcher {
  /** Stop all watchers */
  close: () => void;
  /** Number of directories being watched */
  watchCount: number;
}

/**
 * Watch constitution files across all configured roots.
 * Triggers a debounced graph rebuild when changes are detected.
 */
export function startWatcher(server: ContexGinServer, config: ServerConfig): Watcher {
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      server.rebuild().catch((err) => {
        console.error('[watcher] rebuild failed:', err.message);
      });
    }, config.debounceMs);
  }

  // Watch each root for CONSTITUTION.md / CLAUDE.md changes
  for (const root of config.roots) {
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const base = path.basename(filename);
        if (base === 'CONSTITUTION.md' || base === 'CLAUDE.md') {
          scheduleRebuild();
        }
      });

      watcher.on('error', (err) => {
        console.error(`[watcher] error on ${root}:`, err.message);
      });

      watchers.push(watcher);
    } catch (err) {
      console.error(`[watcher] cannot watch ${root}:`, (err as Error).message);
    }
  }

  return {
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.close();
      watchers.length = 0;
    },
    watchCount: watchers.length,
  };
}
