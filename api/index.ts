import type { IncomingMessage, ServerResponse } from 'http';
import type { Application } from 'express';

// Imported from the compiled output, not from `src/`, and this is load-bearing.
// Vercel builds this entrypoint with esbuild, which does not implement
// `emitDecoratorMetadata` — bundling the TypeScript sources directly strips the
// `design:paramtypes` metadata that Nest's DI container reads to resolve
// constructor dependencies, and every injection fails at runtime. `nest build`
// (tsc) emits that metadata correctly, so the build command produces `dist/`
// and we load the already-compiled app from there. `includeFiles: "dist/**"` in
// vercel.json is what ships those files alongside the function.
import { createApp } from '../dist/create-app';

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
