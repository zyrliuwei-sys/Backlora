import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiDelete, apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import {
  ExternalLink,
  Pager,
  qs,
  useDebounced,
  type MyBacklink,
  type Paged,
} from './-shared';

type Batch = { id: string; name: string; count: number };

function LibraryLinks({ batchId }: { batchId: string }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const search = useDebounced(input.trim());
  const pageSize = 10;
  const links = useQuery({
    queryKey: ['my-backlinks', 'batch-links', batchId, search, page],
    queryFn: () =>
      apiGet<Paged<MyBacklink>>(
        `/api/my-backlinks?${qs({ batch: batchId, search, page, pageSize })}`
      ),
  });
  const rows = links.data?.list ?? [];
  const total = links.data?.pagination.total ?? 0;
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/my-backlinks/${encodeURIComponent(id)}`),
    onSuccess: () => {
      if (rows.length === 1 && page > 1) setPage(page - 1);
      for (const key of ['my-backlinks', 'backlink-facets', 'favorites'])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(m['dash.common.deleted']());
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3 border-t px-4 py-3">
      <Input
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setPage(1);
        }}
        aria-label={m['dash.my.search_placeholder']()}
        placeholder={m['dash.my.search_placeholder']()}
      />
      {links.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {m['dash.add.load_error']()}
        </p>
      ) : links.isPending ? (
        <p className="text-muted-foreground text-sm">
          {m['dash.add.loading']()}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {m['dash.common.empty']()}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <ExternalLink className="min-w-0 text-sm" href={link.link} />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-destructive shrink-0"
                aria-label={m['dash.my.delete_link']({ url: link.link })}
                disabled={remove.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: m['dash.my.remove_title'](),
                      description: m['dash.my.remove_desc']({
                        name: link.link,
                      }),
                      destructive: true,
                    })
                  )
                    remove.mutate(link.id);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {total > pageSize && (
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}
      {dialog}
    </div>
  );
}

export function LibraryBatches() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 10;
  const batches = useQuery({
    queryKey: ['my-backlinks', 'batches', page],
    queryFn: () =>
      apiGet<Paged<Batch> & { unbatched: number }>(
        `/api/my-backlinks/batches?${qs({ page, pageSize })}`
      ),
  });
  const total = batches.data?.pagination.total ?? 0;
  const unbatched = batches.data?.unbatched ?? 0;
  const rows = batches.data?.list ?? [];
  const groups =
    unbatched || expanded === 'unbatched'
      ? [
          ...rows,
          { id: 'unbatched', name: m['dash.my.unbatched'](), count: unbatched },
        ]
      : rows;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m['dash.my.batches']()}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {batches.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {m['dash.add.load_error']()}
          </p>
        ) : batches.isPending ? (
          <p className="text-muted-foreground text-sm">
            {m['dash.add.loading']()}
          </p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m['dash.my.no_batches']()}
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {groups.map(({ id, name, count }) => {
              const open = expanded === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : id)}
                    className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
                  >
                    <ChevronRight
                      className={
                        open ? 'size-4 shrink-0 rotate-90' : 'size-4 shrink-0'
                      }
                    />
                    <span className="min-w-0 flex-1 font-medium break-words">
                      {name}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {m['dash.my.batch_url_count']({ count })}
                    </span>
                  </button>
                  {open && <LibraryLinks batchId={id} />}
                </li>
              );
            })}
          </ul>
        )}
        {total > pageSize && (
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
          />
        )}
      </CardContent>
    </Card>
  );
}
