import type { IncomingMessage, ServerResponse } from 'http';
import type { Application } from 'express';

import { createApp } from '../src/create-app';

/**
 * Vercel serverless entrypoint.
 *
 * Vercel gives each function a Node runtime but no long-lived process: the
 * container is created on demand and frozen between requests. Two things
 * follow, and both are handled here.
 *
 * 1. Bootstrapping Nest on every request would be far too slow and would open
 *    a fresh Mongoose connection each time, quickly exhausting the Atlas
 *    connection limit. The promise below is module-scoped, so a warm container
 *    reuses one initialized app — and therefore one connection pool — across
 *    every request it serves.
 *
 * 2. `app.listen()` must NOT be called. Vercel owns the socket; we hand it the
 *    underlying Express request handler instead.
 *
 * The cache holds the *promise*, not the resolved app, so concurrent requests
 * arriving during a cold start all await the same initialization rather than
 * each starting their own.
 */
let appPromise: Promise<Application> | null = null;

async function getExpressApp(): Promise<Application> {
  const app = await createApp();
  // `init()` runs module lifecycle hooks without binding a port
  await app.init();
  return app.getHttpAdapter().getInstance() as Application;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (!appPromise) {
    appPromise = getExpressApp().catch((error) => {
      // Clear the cache so a failed cold start doesn't poison every later
      // request on this container with the same rejected promise.
      appPromise = null;
      throw error;
    });
  }

  const expressApp = await appPromise;
  return expressApp(req, res);
}
