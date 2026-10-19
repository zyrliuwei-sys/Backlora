import { createFileRoute } from '@tanstack/react-router';
import { buildApiDoc } from '@/routes/dashboard/-agent-prompt';

// The agent API contract as a Codex skill file, like Submify's /skill/codex.md.
// It holds no secrets: the API key only ever goes in the user's own prompt.
export const Route = createFileRoute('/skill/codex.md')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(buildApiDoc(new URL(request.url).origin), {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        }),
    },
  },
});
