import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { BACKLINK_CATEGORIES, MAX_ADD_BATCH } from '@/config/backlinks';
import { apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
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
import { Textarea } from '@/components/ui/textarea';

import { categoryLabel, Pager, qs, useFacets, type Paged } from './-shared';

type SetSpec =
  | { kind: 'all' }
  | { kind: 'recommended' }
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string };

type Target = { websiteId: string; websiteName: string };

type AddResult = { added: number; skipped?: number; invalid?: number };

function setKey(s: SetSpec) {
  return s.kind === 'all' || s.kind === 'recommended'
    ? s.kind
    : `${s.kind}:${s.value}`;
}

function SetOption({
  checked,
  onSelect,
  label,
  hint,
  count,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      )}
    >
      <span
        className={cn(
          'size-3.5 shrink-0 rounded-full border',
          checked && 'border-primary border-4'
        )}
      />
      <Badge variant="outline" className="font-normal">
        {label}
      </Badge>
      {hint && (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {hint}
        </span>
      )}
      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
        {count === undefined ? '…' : count}
      </span>
    </button>
  );
}

function SetsTab({
  selected,
  onSelect,
}: {
  selected: SetSpec | null;
  onSelect: (s: SetSpec) => void;
}) {
  const facets = useFacets('personal');
  const [customTag, setCustomTag] = useState('');
  const key = selected ? setKey(selected) : '';
  const f = facets.data;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {m['dash.add.sets_hint']({ max: MAX_ADD_BATCH })}
      </p>
      <div className="flex gap-2">
        <Input
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          placeholder={m['dash.add.custom_tag']()}
        />
        <Button
          variant="outline"
          disabled={!customTag.trim()}
          onClick={() => onSelect({ kind: 'tag', value: customTag.trim() })}
        >
          <Plus className="size-4" />
          {m['dash.add.add_backlinks']()}
        </Button>
      </div>
      <div className="space-y-2">
        <div className="text-muted-foreground text-xs">
          {m['dash.add.recommended']()}
        </div>
        <SetOption
          checked={key === 'all'}
          onSelect={() => onSelect({ kind: 'all' })}
          label={m['dash.add.all_personal']()}
          hint={m['dash.add.all_personal_hint']()}
          count={f?.total}
        />
        <SetOption
          checked={key === 'recommended'}
          onSelect={() => onSelect({ kind: 'recommended' })}
          label={m['dash.add.recommended']()}
          hint={m['dash.add.recommended_personal_hint']()}
          count={f?.recommended}
        />
      </div>
      <div className="space-y-2">
        <div className="text-muted-foreground text-xs">
          {m['dash.add.by_category']()}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {BACKLINK_CATEGORIES.map((c) => (
            <SetOption
              key={c}
              checked={key === `category:${c}`}
              onSelect={() => onSelect({ kind: 'category', value: c })}
              label={categoryLabel[c]()}
              count={f?.categories[c]}
            />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-muted-foreground text-xs">
          {m['dash.add.by_tag']()}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(f?.tags ?? []).slice(0, 9).map((t) => (
            <SetOption
              key={t.tag}
              checked={key === `tag:${t.tag}`}
              onSelect={() => onSelect({ kind: 'tag', value: t.tag })}
              label={t.tag}
              count={t.count}
            />
          ))}
        </div>
        {selected?.kind === 'tag' &&
          !(f?.tags ?? [])
            .slice(0, 9)
            .some((t) => t.tag === selected.value) && (
            <p className="text-sm">
              {m['dash.add.custom_tag_selected']({ tag: selected.value })}
            </p>
          )}
        <p className="text-muted-foreground text-xs">
          {m['dash.add.custom_tag_hint']()}
        </p>
      </div>
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
      <p className="text-muted-foreground py-4">{m['dash.my.no_batches']()}</p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-lg border">
        {groups.map(({ id, name, count }) => (
          <li key={id}>
            <label className="hover:bg-muted/40 flex items-center gap-3 px-3 py-3 has-[:disabled]:opacity-60">
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
              <span className="min-w-0 flex-1 font-medium break-words">
                {name}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
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
  const [tab, setTab] = useState('personal');
  const [set, setSet] = useState<SetSpec | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<Map<string, number>>(
    () => new Map()
  );
  const [urls, setUrls] = useState('');
  const selectedCount = [...selectedBatches.values()].reduce(
    (total, count) => total + count,
    0
  );

  const body = (): object | null => {
    if (tab === 'sets') return set ? { scope: 'personal', set } : null;
    if (tab === 'personal')
      return selectedCount > 0 && selectedCount <= MAX_ADD_BATCH
        ? { batchIds: [...selectedBatches.keys()] }
        : null;
    const list = urls
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    return list.length ? { urls: list } : null;
  };

  const add = useMutation({
    mutationFn: (b: object) =>
      apiPost<AddResult>(`/api/websites/${target.websiteId}/backlinks`, b),
    onSuccess: (r) => {
      toast.success(
        m['dash.add.done']({
          added: r.added,
          skipped: r.skipped ?? 0,
          invalid: r.invalid ?? 0,
        })
      );
      for (const k of [
        'websites',
        'website-records',
        'my-backlinks',
        'backlink-facets',
        'dashboard-stats',
        'favorites',
      ])
        queryClient.invalidateQueries({ queryKey: [k] });
      onDone?.(r);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = body();
  return (
    <div className="min-w-0 space-y-4">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        className="flex-col"
      >
        <TabsList className="w-full">
          <TabsTrigger value="personal">
            {m['dash.nav.my_backlinks']()}
          </TabsTrigger>
          <TabsTrigger value="sets">{m['dash.add.tab_sets']()}</TabsTrigger>
          <TabsTrigger value="urls">{m['dash.add.tab_urls']()}</TabsTrigger>
        </TabsList>
        <TabsContent value="personal" className="pt-3">
          <LibraryPicker
            selected={selectedBatches}
            onChange={setSelectedBatches}
            selectedCount={selectedCount}
          />
        </TabsContent>
        <TabsContent value="sets" className="pt-3">
          <SetsTab selected={set} onSelect={setSet} />
        </TabsContent>
        <TabsContent value="urls" className="space-y-2 pt-3">
          <Textarea
            rows={12}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={m['dash.add.urls_placeholder']()}
            className="field-sizing-fixed h-64 font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            {m['dash.add.urls_hint']()}
          </p>
        </TabsContent>
      </Tabs>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {m['dash.common.cancel']()}
          </Button>
        )}
        <Button
          disabled={!ready || add.isPending}
          onClick={() => ready && add.mutate(ready)}
        >
          {m['dash.add.submit_website']()}
        </Button>
      </div>
    </div>
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m['dash.add.title']()}</DialogTitle>
          <DialogDescription>
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
