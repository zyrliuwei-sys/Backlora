import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Skeleton } from '@/components/ui/skeleton';

import { SettingsForm } from '../settings/-settings-form';
import { PageHeader } from './-shared';

function SettingsPage() {
  const { data: user } = useQuery({
    queryKey: ['user-info'],
    queryFn: async () => {
      const data = await apiGet<{
        name?: string;
        email?: string;
        image?: string;
      }>('/api/user/info');
      return {
        name: data.name || '',
        email: data.email || '',
        image: data.image || '',
      };
    },
  });
  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader title={m['dash.nav.settings']()} />
      {user ? (
        <div className="-mx-6">
          <SettingsForm
            name={user.name}
            email={user.email}
            image={user.image}
          />
        </div>
      ) : (
        <Skeleton className="mt-6 h-64 w-full" />
      )}
    </div>
  );
}

export const Route = createFileRoute('/dashboard/settings')({
  component: SettingsPage,
});
