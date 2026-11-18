import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard/backlinks')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/my-backlinks', replace: true });
  },
});
