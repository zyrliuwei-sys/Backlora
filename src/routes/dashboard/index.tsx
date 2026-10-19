import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CircleCheck,
  CircleDashed,
  Globe,
  KeyRound,
  Link2,
  Pencil,
  Plus,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { ExternalLink, PageHeader, type Website } from './-shared';

type Stats = {
  websites: number;
  records: number;
  inProgress: number;
  done: number;
  recentWebsites: Website[];
};

function Tile({
  label,
  value,
  icon,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm font-medium">
          {label}
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-3xl font-semibold tabular-nums">
          {value === undefined ? <Skeleton className="h-9 w-20" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function Entry({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 transition-colors"
    >
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-sm">
          {desc}
        </span>
      </span>
    </Link>
  );
}

function DashboardPage() {
  const stats = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiGet<Stats>('/api/dashboard/stats'),
  });
  const s = stats.data;

  return (
    <>
      <PageHeader
        title={m['dash.home.title']()}
        description={m['dash.home.description']()}
        actions={
          <>
            <Link href="/dashboard/websites/new" className={buttonVariants()}>
              <Plus className="size-4" />
              {m['dash.home.add_website']()}
            </Link>
            <Link
              href="/dashboard/website-backlinks"
              className={buttonVariants({ variant: 'outline' })}
            >
              {m['dash.nav.tracking']()}
            </Link>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label={m['dash.home.websites']()}
          value={s?.websites}
          icon={<Globe className="size-4" />}
        />
        <Tile
          label={m['dash.home.records']()}
          value={s?.records}
          icon={<Link2 className="size-4" />}
        />
        <Tile
          label={m['dash.home.in_progress']()}
          value={s?.inProgress}
          icon={<CircleDashed className="size-4" />}
        />
        <Tile
          label={m['dash.home.done']()}
          value={s?.done}
          icon={<CircleCheck className="size-4" />}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardContent className="space-y-4">
            <div>
              <div className="font-semibold">{m['dash.home.recent']()}</div>
              <div className="text-muted-foreground text-sm">
                {m['dash.home.recent_desc']()}
              </div>
            </div>
            <Link
              href="/dashboard/websites"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {m['dash.home.manage_websites']()}
            </Link>
            {s && s.recentWebsites.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {m['dash.home.no_websites']()}
              </p>
            )}
            <div className="space-y-3">
              {(s?.recentWebsites ?? []).map((w) => (
                <div key={w.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{w.name}</span>
                        <Badge variant="secondary" className="font-normal">
                          {w.status === 'enabled'
                            ? m['dash.common.enabled']()
                            : m['dash.common.disabled']()}
                        </Badge>
                      </div>
                      <ExternalLink
                        href={w.url}
                        className="text-muted-foreground text-sm"
                      />
                    </div>
                    <Link
                      href={`/dashboard/websites/${w.id}/edit`}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' })
                      )}
                    >
                      <Pencil className="size-4" />
                      {m['dash.home.manage_website']()}
                    </Link>
                  </div>
                  <div className="mt-3 grid grid-cols-3 border-t pt-3">
                    {[
                      [m['dash.common.total'](), w.counts?.total ?? 0],
                      [m['dash.home.in_progress'](), w.counts?.inProgress ?? 0],
                      [m['dash.home.done'](), w.counts?.done ?? 0],
                    ].map(([label, n]) => (
                      <div key={label as string}>
                        <div className="text-muted-foreground text-xs">
                          {label}
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {n}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardContent className="space-y-3">
            <div>
              <div className="font-semibold">{m['dash.home.shortcuts']()}</div>
              <div className="text-muted-foreground text-sm">
                {m['dash.home.shortcuts_desc']()}
              </div>
            </div>
            <Entry
              href="/dashboard/websites"
              icon={<Globe className="size-4" />}
              title={m['dash.home.entry_websites']()}
              desc={m['dash.home.entry_websites_desc']()}
            />
            <Entry
              href="/dashboard/website-backlinks"
              icon={<Link2 className="size-4" />}
              title={m['dash.home.entry_records']()}
              desc={m['dash.home.entry_records_desc']()}
            />
            <Entry
              href="/dashboard/websites/new"
              icon={<Plus className="size-4" />}
              title={m['dash.home.add_website']()}
              desc={m['dash.home.entry_new_desc']()}
            />
            <Entry
              href="/dashboard/apikeys"
              icon={<KeyRound className="size-4" />}
              title="API Keys"
              desc={m['dash.home.entry_keys_desc']()}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export const Route = createFileRoute('/dashboard/')({
  component: DashboardPage,
});
