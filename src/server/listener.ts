import * as fs from 'node:fs';
import type { ContexGinServer } from './app.js';
import type { ServerConfig } from './types.js';

export interface ListenerInfo {
  /** TCP address (host:port) */
  tcp: string;
  /** Unix socket path, if configured */
  socket: string | null;
}

/**
 * Start the server on TCP and optionally a Unix socket.
 * Returns the bound addresses.
 */
export async function startListeners(
  server: ContexGinServer,
  config: ServerConfig,
): Promise<ListenerInfo> {
  // Start TCP listener
  const tcpAddress = await server.app.listen({ port: config.port, host: config.host });

  let socket: string | null = null;

  // Start Unix socket listener if configured
  if (config.socketPath) {
    // Remove stale socket file if it exists
    try {
      fs.unlinkSync(config.socketPath);
    } catch {
      // Doesn't exist — fine
    }

    await server.app.listen({ path: config.socketPath });
    socket = config.socketPath;
  }

  return { tcp: tcpAddress, socket };
}
