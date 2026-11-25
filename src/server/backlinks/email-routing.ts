import { definePlugin } from 'nitro';

import { runWithDbScope } from '@/core/db/request-scope';
import { routeIncomingMail } from '@/modules/backlinks/verification-mail';

export default definePlugin((app) => {
  app.hooks.hook('cloudflare:email', async ({ message, env }) => {
    (globalThis as { __CF_ENV__?: unknown }).__CF_ENV__ = env;
    await runWithDbScope(() => routeIncomingMail(message));
  });
});
