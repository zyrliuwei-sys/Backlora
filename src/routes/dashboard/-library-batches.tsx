import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
type Deletion = { mode: 'selected'; ids: string[] } | { mode: 'batch' };

function LibraryLinks({
  batch,
  onCleared,
}: {
  batch: Batch;
  onCleared: () => void;
}) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const search = useDebounced(input.trim());
  const pageSize = 10;
  const links = useQuery({
    queryKey: ['my-backlinks', 'batch-links', batch.id, search, page],
    queryFn: () =>
      apiGet<Paged<MyBacklink>>(
        `/api/my-backlinks?${qs({ batch: batch.id, search, page, pageSize })}`
      ),
  });
  const rows = links.data?.list ?? [];
  const total = links.data?.pagination.total ?? 0;
  const selected = rows.filter((link) => selection.has(link.id));
  const allChecked = rows.length > 0 && selected.length === rows.length;
  const remove = useMutation({
    mutationFn: (deletion: Deletion) =>
      apiPost<{ deleted: number }>('/api/my-backlinks/batch-delete', {
        batchId: batch.id,
        ...deletion,
      }),
    onSuccess: ({ deleted }, deletion) => {
      setSelection(new Set());
      if (deletion.mode === 'batch') {
        onCleared();
      } else if (deleted >= rows.length && page > 1) {
        setPage(page - 1);
      }
      for (const key of [
        'my-backlinks',
        'backlink-facets',
        'favorites',
        'dashboard-stats',
      ])
        queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(m['dash.my.removed_count']({ count: deleted }));
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
          setSelection(new Set());
        }}
        aria-label={m['dash.my.search_placeholder']()}
        placeholder={m['dash.my.search_placeholder']()}
      />
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <label className="text-muted-foreground me-auto flex items-center gap-2 text-xs">
          <Checkbox
            checked={allChecked}
            indeterminate={selected.length > 0 && !allChecked}
            disabled={
              remove.isPending || rows.length === 0 || input.trim() !== search
            }
            onCheckedChange={(checked) =>
              setSelection(
                checked ? new Set(rows.map((link) => link.id)) : new Set()
              )
            }
          />
          {m['dash.my.select_page']()}
        </label>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!selected.length || remove.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: m['dash.my.remove_selected_title'](),
                description: m['dash.my.remove_selected_desc']({
                  count: selected.length,
                }),
                destructive: true,
              })
            )
              remove.mutate({
                mode: 'selected',
                ids: selected.map((link) => link.id),
              });
          }}
        >
          <Trash2 />
          {selected.length
            ? m['dash.my.remove_selected_count']({ count: selected.length })
            : m['dash.my.remove_selected']()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!batch.count || remove.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: m['dash.my.remove_batch_title'](),
                description: m['dash.my.remove_batch_desc']({
                  name: batch.name,
                }),
                destructive: true,
              })
            )
              remove.mutate({ mode: 'batch' });
          }}
        >
          {m['dash.my.remove_batch']()}
        </Button>
      </div>
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
              <Checkbox
                aria-label={m['dash.my.select_link']({ url: link.link })}
                checked={selection.has(link.id)}
                disabled={remove.isPending || input.trim() !== search}
                onCheckedChange={(checked) =>
                  setSelection((current) => {
                    const next = new Set(current);
                    if (checked) next.add(link.id);
                    else next.delete(link.id);
                    return next;
                  })
                }
              />
              <ExternalLink
                className="min-w-0 flex-1 text-sm"
                href={link.link}
              />
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
                    remove.mutate({ mode: 'selected', ids: [link.id] });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {total > pageSize && (
        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={(next) => {
            setPage(next);
            setSelection(new Set());
          }}
        />
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
            {groups.map((batch) => {
              const { id, name, count } = batch;
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
                  {open && (
                    <LibraryLinks
                      batch={batch}
                      onCleared={() =>
                        setExpanded((current) =>
                          current === id ? null : current
                        )
                      }
                    />
                  )}
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
