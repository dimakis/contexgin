import * as fs from 'node:fs';
import type { ContexGinServer } from './app.js';
import type { ServerConfig } from './types.js';

export interface ListenerInfo {
  /** Bound address — TCP URL or Unix socket path */
  address: string;
  /** Whether listening on a Unix socket */
  isSocket: boolean;
}

/**
 * Start the server on either TCP or a Unix socket.
 * Fastify v5 only supports a single listen() call per instance,
 * so Unix socket takes priority when configured.
 */
export async function startListeners(
  server: ContexGinServer,
  config: ServerConfig,
): Promise<ListenerInfo> {
  if (config.socketPath) {
    // Remove stale socket file if it exists
    try {
      fs.unlinkSync(config.socketPath);
    } catch {
      // Doesn't exist — fine
    }

    await server.app.listen({ path: config.socketPath });
    return { address: config.socketPath, isSocket: true };
  }

  // TCP listener
  const address = await server.app.listen({ port: config.port, host: config.host });
  return { address, isSocket: false };
}
