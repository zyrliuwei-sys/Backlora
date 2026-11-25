import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { MAX_ADD_BATCH } from '@/config/backlinks';
import { apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { BatchImportForm, type BatchImportInput } from './-batch-import-form';
import {
  Pager,
  qs,
  useDebounced,
  type Paged,
  type SuccessfulTarget,
} from './-shared';

type Target = { websiteId: string; websiteName: string };
type AddResult = {
  added: number;
  skipped: number;
  invalid?: number;
  libraryAdded?: number;
};
type SuccessfulSelection = string[] | 'all';
type AddInput =
  | { batchIds: string[] }
  | { successfulTargets: SuccessfulSelection }
  | BatchImportInput;

function SelectionFooter({
  count,
  pending,
  onAdd,
  onCancel,
}: {
  count: number;
  pending: boolean;
  onAdd: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-muted-foreground text-sm tabular-nums" role="status">
        {m['dash.add.selected']({ count })}
      </p>
      <div className="ms-auto flex gap-2">
        {onCancel && (
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {m['dash.common.cancel']()}
          </Button>
        )}
        <Button
          disabled={pending || count === 0 || count > MAX_ADD_BATCH}
          onClick={onAdd}
        >
          {m['dash.add.submit_website']()}
        </Button>
      </div>
    </div>
  );
}

function SuccessfulPicker({
  websiteId,
  pending,
  onAdd,
  onCancel,
}: {
  websiteId: string;
  pending: boolean;
  onAdd: (selection: SuccessfulSelection) => void;
  onCancel?: () => void;
}) {
  const [input, setInput] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const search = useDebounced(input.trim());
  const pageSize = 20;
  const candidates = useQuery({
    queryKey: [
      'website-records',
      'successful-targets',
      websiteId,
      search,
      page,
    ],
    queryFn: () =>
      apiGet<Paged<SuccessfulTarget>>(
        `/api/websites/${websiteId}/backlinks?${qs({ search, page, pageSize })}`
      ),
  });
  const rows = candidates.data?.list ?? [];
  const total = candidates.data?.pagination.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-36 flex-1"
          value={input}
          placeholder={m['dash.add.successful_search']()}
          aria-label={m['dash.add.successful_search']()}
          onChange={(event) => {
            setInput(event.target.value);
            setPage(1);
          }}
        />
        {!input.trim() && !search && total > 0 && total <= MAX_ADD_BATCH && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onAdd('all')}
          >
            {m['dash.add.successful_add_all']({ count: total })}
          </Button>
        )}
      </div>
      {candidates.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {m['dash.add.load_error']()}
        </p>
      ) : candidates.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {m['dash.add.loading']()}
        </p>
      ) : !rows.length ? (
        <p className="text-muted-foreground rounded-lg border px-4 py-5 text-sm">
          {m['dash.add.successful_empty']()}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || rows.every(({ url }) => selected.has(url))}
              onClick={() =>
                setSelected(
                  (value) => new Set([...value, ...rows.map(({ url }) => url)])
                )
              }
            >
              {m['dash.add.select_results']()}
            </Button>
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setSelected(new Set())}
              >
                {m['dash.add.clear_selection']()}
              </Button>
            )}
          </div>
          <ul className="max-h-72 divide-y overflow-auto rounded-lg border">
            {rows.map(({ url, status }) => (
              <li key={url}>
                <label className="hover:bg-muted/40 has-[[data-checked]]:bg-primary/5 flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <Checkbox
                    checked={selected.has(url)}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(url);
                        else next.delete(url);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate" title={url}>
                    {url}
                  </span>
                  <Badge variant={status === 'live' ? 'default' : 'secondary'}>
                    {status === 'live'
                      ? m['dash.my.success_live']()
                      : m['dash.add.successful_submitted']()}
                  </Badge>
                </label>
              </li>
            ))}
          </ul>
          {total > pageSize && (
            <Pager
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
            />
          )}
        </>
      )}
      {selected.size > MAX_ADD_BATCH && (
        <p className="text-destructive text-xs" role="alert">
          {m['dash.my.batch_limit']({ max: MAX_ADD_BATCH })}
        </p>
      )}
      <SelectionFooter
        count={selected.size}
        pending={pending}
        onAdd={() => onAdd([...selected])}
        onCancel={onCancel}
      />
    </div>
  );
}

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
  defaultTab = 'library',
}: {
  target: Target;
  onDone?: (r: AddResult) => void;
  onCancel?: () => void;
  defaultTab?: 'library' | 'successful';
}) {
  const queryClient = useQueryClient();
  const [selectedBatches, setSelectedBatches] = useState<Map<string, number>>(
    () => new Map()
  );
  const selectedCount = [...selectedBatches.values()].reduce(
    (total, count) => total + count,
    0
  );

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
        const message = m['dash.add.done'](r);
        if ('successfulTargets' in input && r.added === 0) {
          toast.info(message);
          return;
        }
        toast.success(message);
      }
      onDone?.(r);
    },
    onError: (error: Error, input) => {
      if (!('urls' in input)) toast.error(error.message);
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
      defaultValue={defaultTab}
    >
      <TabsList className="grid h-11 w-full min-w-0 grid-cols-3 items-stretch gap-1 group-data-horizontal/tabs:h-11">
        <TabsTrigger
          className="dark:data-active:bg-background h-full min-w-0 text-center leading-tight whitespace-normal"
          value="library"
          disabled={add.isPending}
        >
          {m['dash.nav.my_backlinks']()}
        </TabsTrigger>
        <TabsTrigger
          className="dark:data-active:bg-background h-full min-w-0 text-center leading-tight whitespace-normal"
          value="successful"
          disabled={add.isPending}
        >
          {m['dash.add.successful_tab']()}
        </TabsTrigger>
        <TabsTrigger
          className="dark:data-active:bg-background h-full min-w-0 text-center leading-tight whitespace-normal"
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
        <SelectionFooter
          count={selectedCount}
          pending={add.isPending}
          onCancel={onCancel}
          onAdd={() => add.mutate({ batchIds: [...selectedBatches.keys()] })}
        />
      </TabsContent>
      <TabsContent value="successful" className="min-w-0">
        <SuccessfulPicker
          websiteId={target.websiteId}
          pending={add.isPending}
          onCancel={onCancel}
          onAdd={(successfulTargets) => add.mutate({ successfulTargets })}
        />
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
