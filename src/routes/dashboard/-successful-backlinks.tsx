import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';

import { Link } from '@/core/i18n/navigation';
import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import {
  ExternalLink,
  qs,
  useDebounced,
  type Paged,
  type SuccessfulTarget,
} from './-shared';

const pageSize = 6;

function targetQuery(page: number, search = '') {
  return {
    queryKey: ['website-records', 'successful-library', search, page],
    queryFn: () =>
      apiGet<Paged<SuccessfulTarget>>(
        `/api/website/backlinks?${qs({ view: 'successful-targets', search, page, pageSize })}`
      ),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  };
}

export function SuccessfulBacklinks() {
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const search = useDebounced(input.trim());
  const all = useQuery({
    ...targetQuery(search ? 1 : page),
    placeholderData: keepPreviousData,
  });
  const filtered = useQuery({
    ...targetQuery(page, search),
    enabled: !!search,
  });
  const records = search ? filtered : all;
  const rows = records.data?.list ?? [];
  const pages = Math.max(
    1,
    Math.ceil((records.data?.pagination.total ?? 0) / pageSize)
  );
  const total = all.data?.pagination.total;

  return (
    <Card className="min-w-0 gap-0 py-0" aria-labelledby="successful-backlinks">
      <CardHeader className="bg-muted/20 border-b px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2
              className="text-primary size-4 shrink-0"
              aria-hidden
            />
            <h2 id="successful-backlinks">{m['dash.my.success_tab']()}</h2>
          </CardTitle>
          <p
            className="text-primary text-base font-semibold tabular-nums"
            role="status"
          >
            {total !== undefined &&
              m['dash.my.batch_url_count']({ count: total })}
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          {m['dash.my.success_reuse_hint']()}
        </p>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-3 px-4 py-4 sm:px-5">
        <Input
          type="search"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setPage(1);
          }}
          placeholder={m['dash.add.successful_search']()}
          aria-label={m['dash.add.successful_search']()}
        />
        {records.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-destructive text-sm">
              {m['dash.add.load_error']()}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void records.refetch()}
            >
              {m['dash.my.success_retry']()}
            </Button>
          </div>
        ) : records.isPending || records.isPlaceholderData ? (
          <div role="status" className="grid gap-2 py-1">
            <span className="sr-only">{m['dash.common.loading']()}</span>
            <Skeleton className="h-8 w-full motion-reduce:animate-none" />
            <Skeleton className="h-8 w-full motion-reduce:animate-none" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-3 text-sm">
            {search
              ? m['dash.my.success_no_matches']()
              : m['dash.my.success_empty']()}
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map(({ url, status }) => (
              <li className="flex min-w-0 items-center gap-3 py-2.5" key={url}>
                <ExternalLink href={url} className="min-w-0 flex-1 text-sm">
                  <span title={url}>{url}</span>
                </ExternalLink>
                <Badge
                  variant={status === 'live' ? 'outline' : 'secondary'}
                  className="shrink-0"
                >
                  {status === 'live'
                    ? m['dash.my.success_live']()
                    : m['dash.add.successful_submitted']()}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {total !== undefined && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <Link
              href="/dashboard/websites/new"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {m['dash.websites.new']()}
            </Link>
            {(pages > 1 || page > 1) && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={m['dash.pager.prev']()}
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {page} / {Math.max(page, pages)}
                </span>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={m['dash.pager.next']()}
                  disabled={page >= pages || records.isPlaceholderData}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
