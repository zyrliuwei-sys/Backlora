import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { MAX_ADD_BATCH } from '@/config/backlinks';
import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { BatchImportForm, type BatchImportInput } from './-batch-import-form';
import { Pager, qs, type Paged } from './-shared';

type Target = { websiteId: string; websiteName: string };
type AddResult = {
  added: number;
  skipped: number;
  invalid?: number;
  libraryAdded?: number;
};
type AddInput = { batchIds: string[] } | BatchImportInput;

function LibraryPicker({
  selected,
  onChange,
  selectedCount,
}: {
  selected: Map<string, number>;
  onChange: (batches: Map<string, number>) => void;
  selectedCount: number;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const batches = useQuery({
    queryKey: ['my-backlinks', 'batch-picker', page],
    queryFn: () =>
      apiGet<
        Paged<{ id: string; name: string; count: number }> & {
          unbatched: number;
        }
      >(
        `/api/my-backlinks/batches?${qs({ page, pageSize, enabled: 'enabled' })}`
      ),
  });
  const rows = batches.data?.list ?? [];
  const unbatched = batches.data?.unbatched ?? 0;
  const total = batches.data?.pagination.total ?? 0;
  const groups =
    unbatched > 0
      ? [
          ...rows,
          { id: 'unbatched', name: m['dash.my.unbatched'](), count: unbatched },
        ]
      : rows;

  if (batches.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <p role="alert">{m['dash.add.load_error']()}</p>
        <Button size="sm" variant="outline" onClick={() => batches.refetch()}>
          {m['common.error.retry']()}
        </Button>
      </div>
    );
  }
  if (batches.isPending) {
    return (
      <p className="text-muted-foreground py-4">{m['dash.add.loading']()}</p>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="space-y-2 rounded-lg border px-4 py-5 text-sm">
        <p className="text-muted-foreground">{m['dash.my.no_batches']()}</p>
        <Link
          href="/dashboard/my-backlinks"
          className="text-primary font-medium hover:underline"
        >
          {m['dash.add.open_library']()}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-lg border">
        {groups.map(({ id, name, count }) => (
          <li key={id}>
            <label className="hover:bg-muted/40 has-[[data-checked]]:bg-primary/5 grid min-h-12 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60 sm:gap-4 sm:px-4">
              <Checkbox
                checked={selected.has(id)}
                disabled={!count && !selected.has(id)}
                onCheckedChange={(checked) => {
                  const next = new Map(selected);
                  if (checked) next.set(id, count);
                  else next.delete(id);
                  onChange(next);
                }}
              />
              <span className="font-medium wrap-anywhere">{name}</span>
              <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums sm:text-sm">
                {m['dash.my.batch_url_count']({ count })}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {total > pageSize && (
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}
      {selectedCount > MAX_ADD_BATCH && (
        <p className="text-destructive text-xs" role="alert">
          {m['dash.add.batch_limit']({ max: MAX_ADD_BATCH })}
        </p>
      )}
    </div>
  );
}

export function AddBacklinksPanel({
  target,
  onDone,
  onCancel,
}: {
  target: Target;
  onDone?: (r: AddResult) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedBatches, setSelectedBatches] = useState<Map<string, number>>(
    () => new Map()
  );
  const selectedCount = [...selectedBatches.values()].reduce(
    (total, count) => total + count,
    0
  );

  const canAdd = selectedCount > 0 && selectedCount <= MAX_ADD_BATCH;

  const add = useMutation({
    mutationFn: (input: AddInput) =>
      apiPost<AddResult>(`/api/websites/${target.websiteId}/backlinks`, input),
    onSuccess: (r, input) => {
      if ('urls' in input) {
        const libraryAdded = r.libraryAdded ?? 0;
        const message = m['dash.add.import_done']({
          added: r.added,
          skipped: r.skipped,
          invalid: r.invalid ?? 0,
          libraryAdded,
        });
        if (r.added + libraryAdded === 0) {
          toast.info(message);
          return;
        }
        toast.success(message);
      } else {
        toast.success(m['dash.add.done'](r));
      }
      onDone?.(r);
    },
    onError: (error: Error, input) => {
      if ('batchIds' in input) toast.error(error.message);
    },
    onSettled: (_result, _error, input) => {
      const keys = ['websites', 'website-records', 'dashboard-stats'];
      if ('urls' in input)
        keys.push('my-backlinks', 'backlink-facets', 'favorites');
      for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
    },
  });

  return (
    <Tabs
      className="grid min-w-0 grid-cols-1 gap-4 [&>[data-ending-style]]:hidden"
      defaultValue="library"
    >
      <TabsList className="grid h-11 w-full min-w-0 grid-cols-2 items-stretch gap-1 group-data-horizontal/tabs:h-11">
        <TabsTrigger
          className="dark:data-active:bg-background h-full"
          value="library"
          disabled={add.isPending}
        >
          {m['dash.nav.my_backlinks']()}
        </TabsTrigger>
        <TabsTrigger
          className="dark:data-active:bg-background h-full"
          value="urls"
          disabled={add.isPending}
        >
          {m['dash.add.tab_urls']()}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="library" className="min-w-0 space-y-4">
        <LibraryPicker
          selected={selectedBatches}
          onChange={setSelectedBatches}
          selectedCount={selectedCount}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p
            className="text-muted-foreground text-sm tabular-nums"
            role="status"
          >
            {m['dash.add.selected']({ count: selectedCount })}
          </p>
          <div className="ms-auto flex gap-2">
            {onCancel && (
              <Button
                variant="outline"
                disabled={add.isPending}
                onClick={onCancel}
              >
                {m['dash.common.cancel']()}
              </Button>
            )}
            <Button
              disabled={!canAdd || add.isPending}
              onClick={() =>
                add.mutate({ batchIds: [...selectedBatches.keys()] })
              }
            >
              {m['dash.add.submit_website']()}
            </Button>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="urls" className="min-w-0" keepMounted>
        <BatchImportForm
          onCancel={onCancel}
          submitLabel={m['dash.add.submit_website']()}
          destinationHint={m['dash.add.urls_hint']()}
          onImport={async (input) => {
            const result = await add.mutateAsync(input);
            return result.added + (result.libraryAdded ?? 0) > 0;
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

export function AddBacklinksDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: Target;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92dvh,48rem)] grid-cols-1 gap-5 overflow-y-auto sm:max-w-[min(48rem,calc(100%-2rem))] sm:p-6">
        <DialogHeader className="min-w-0 pe-8">
          <DialogTitle className="font-semibold sm:text-lg">
            {m['dash.add.title']()}
          </DialogTitle>
          <DialogDescription className="wrap-anywhere">
            {m['dash.add.description']({ name: target.websiteName })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AddBacklinksPanel
            target={target}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
