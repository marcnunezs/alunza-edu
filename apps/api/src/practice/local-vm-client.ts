import { Inject, Injectable } from '@nestjs/common';
import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request } from 'node:http';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';

/** Private, bounded same-host transport. No URLs, credentials or shell commands. */
@Injectable()
export class LocalVmClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async call(
    route: '/inspect' | '/prepare' | '/start' | '/cleanup' | '/status',
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const socketPath = this.config.localVmConfiguration?.socketPath;
    if (
      !socketPath ||
      process.platform !== 'linux' ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    )
      throw new Error('Local VM transport unavailable');
    const parent = dirname(socketPath);
    const [socket, directory, resolved] = await Promise.all([
      lstat(socketPath),
      lstat(parent),
      realpath(socketPath),
    ]);
    if (
      resolved !== socketPath ||
      !socket.isSocket() ||
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      socket.uid !== process.getuid!() ||
      directory.uid !== process.getuid!() ||
      (socket.mode & 0o077) !== 0 ||
      (directory.mode & 0o077) !== 0
    )
      throw new Error('Local VM socket identity rejected');
    const payload = Buffer.from(JSON.stringify(body));
    if (payload.length > 2097152) throw new Error('Local VM request too large');
    return new Promise((resolve, reject) => {
      let completed = false;
      const finish = (error?: Error, result?: unknown) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      const req = request(
        {
          socketPath,
          path: route,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': payload.length,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (part: Buffer) => {
            bytes += part.length;
            if (bytes > 1048576) {
              finish(new Error('Local VM response too large'));
              req.destroy();
            } else chunks.push(part);
          });
          response.on('error', () =>
            finish(new Error('Local VM transport failed')),
          );
          response.on('end', () => {
            if (response.statusCode !== 200)
              return finish(new Error('Local VM request rejected'));
            try {
              finish(
                undefined,
                JSON.parse(Buffer.concat(chunks).toString('utf8')),
              );
            } catch {
              finish(new Error('Local VM response invalid'));
            }
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error('Local VM transport deadline')),
        Math.max(1, Math.min(40000, Math.floor(timeoutMs))),
      );
      req.on('error', () => finish(new Error('Local VM transport failed')));
      req.end(payload);
    });
  }
}
