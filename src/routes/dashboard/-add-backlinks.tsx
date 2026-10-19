import { useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
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

import {
  categoryLabel,
  FilterSelect,
  qs,
  useFacets,
  type Backlink,
  type MyBacklink,
  type Paged,
} from './-shared';

type SetSpec =
  | { kind: 'recommended' }
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string };

type Target =
  | { kind: 'website'; websiteId: string; websiteName: string }
  | { kind: 'library' };

type AddResult = { added: number; skipped?: number; invalid?: number };

function setKey(s: SetSpec) {
  return s.kind === 'recommended' ? 'recommended' : `${s.kind}:${s.value}`;
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

/** 推荐外链套餐: recommended, by category, by tag, or a custom tag. */
function SetsTab({
  selected,
  onSelect,
}: {
  selected: SetSpec | null;
  onSelect: (s: SetSpec) => void;
}) {
  const facets = useFacets('plaza');
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
          checked={key === 'recommended'}
          onSelect={() => onSelect({ kind: 'recommended' })}
          label={m['dash.add.recommended']()}
          hint={m['dash.add.recommended_hint']()}
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

/** Searchable checklist over the plaza or the user's library. */
function PickTab({
  scope,
  selected,
  onChange,
}: {
  scope: 'plaza' | 'personal';
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('all');
  const facets = useFacets(scope);
  const list = useQuery({
    queryKey: ['add-pick', scope, search, category, tag],
    queryFn: () =>
      scope === 'plaza'
        ? apiGet<Paged<Backlink>>(
            `/api/backlinks?${qs({ page: 1, pageSize: 100, search, category, tag })}`
          )
        : apiGet<Paged<MyBacklink>>(
            `/api/my-backlinks?${qs({ page: 1, pageSize: 100, search, enabled: 'enabled' })}`
          ),
    placeholderData: keepPreviousData,
  });
  const rows = (list.data?.list ?? []).filter(
    (r) => scope === 'plaza' || category === 'all' || r.category === category
  );
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-[200px] flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSearch(input.trim())}
          placeholder={m['dash.add.search_placeholder']()}
        />
        <FilterSelect
          value={category}
          onChange={setCategory}
          allLabel={m['dash.common.all_categories']()}
          options={BACKLINK_CATEGORIES.map((c) => ({
            value: c,
            label: categoryLabel[c](),
          }))}
        />
        {scope === 'plaza' && (
          <FilterSelect
            value={tag}
            onChange={setTag}
            allLabel={m['dash.common.all_tags']()}
            options={(facets.data?.tags ?? []).map((t) => ({
              value: t.tag,
              label: t.tag,
            }))}
          />
        )}
        <Button variant="outline" onClick={() => setSearch(input.trim())}>
          <Search className="size-4" />
          {m['dash.common.search']()}
        </Button>
      </div>
      <div className="rounded-lg border">
        <div className="bg-muted/40 flex items-center justify-between border-b px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={allChecked}
              onCheckedChange={() => {
                const next = new Set(selected);
                for (const r of rows) {
                  if (allChecked) next.delete(r.id);
                  else if (next.size < MAX_ADD_BATCH) next.add(r.id);
                }
                onChange(next);
              }}
            />
            {m['dash.add.select_results']()}
          </label>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={() => onChange(new Set())}
          >
            {m['dash.add.clear_selection']()}
          </button>
        </div>
        <div className="h-[340px] overflow-y-auto">
          {list.isPending ? (
            <p className="text-muted-foreground py-24 text-center text-sm">
              {m['dash.add.loading']()}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-24 text-center text-sm">
              {m['dash.common.empty']()}
            </p>
          ) : (
            rows.map((r) => (
              <label
                key={r.id}
                className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
              >
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => {
                    const next = new Set(selected);
                    if (next.has(r.id)) next.delete(r.id);
                    else if (next.size < MAX_ADD_BATCH) next.add(r.id);
                    onChange(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {r.link}
                  </div>
                </div>
                <Badge variant="outline" className="font-normal">
                  {categoryLabel[r.category]?.() ?? r.category}
                </Badge>
                <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                  {r.dr ?? '–'}
                </span>
              </label>
            ))
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {m['dash.add.selected']({ count: selected.size, max: MAX_ADD_BATCH })}
      </p>
    </div>
  );
}

/**
 * 添加外链 / 批量导入外链 body. `target` decides where the entries go:
 * a website's submission records, or the user's library.
 */
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
  const [tab, setTab] = useState('sets');
  const [set, setSet] = useState<SetSpec | null>(null);
  const [plazaIds, setPlazaIds] = useState<Set<string>>(new Set());
  const [personalIds, setPersonalIds] = useState<Set<string>>(new Set());
  const [urls, setUrls] = useState('');
  const isWebsite = target.kind === 'website';

  const body = (): object | null => {
    if (tab === 'sets') return set ? { scope: 'plaza', set } : null;
    if (tab === 'plaza') return plazaIds.size ? { ids: [...plazaIds] } : null;
    if (tab === 'personal')
      return personalIds.size ? { ids: [...personalIds] } : null;
    const list = urls
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean);
    return list.length ? { urls: list } : null;
  };

  const add = useMutation({
    mutationFn: (b: object) =>
      apiPost<AddResult>(
        isWebsite
          ? `/api/websites/${target.websiteId}/backlinks`
          : '/api/my-backlinks/batch-import',
        b
      ),
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
    <div className="space-y-4">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(String(v))}
        className="flex-col"
      >
        <TabsList className="w-full">
          <TabsTrigger value="sets">{m['dash.add.tab_sets']()}</TabsTrigger>
          <TabsTrigger value="plaza">
            {isWebsite ? m['dash.add.tab_plaza']() : m['dash.add.tab_all']()}
          </TabsTrigger>
          {isWebsite && (
            <TabsTrigger value="personal">
              {m['dash.add.tab_personal']()}
            </TabsTrigger>
          )}
          <TabsTrigger value="urls">
            {isWebsite
              ? m['dash.add.tab_urls']()
              : m['dash.add.tab_import_urls']()}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sets" className="pt-3">
          <SetsTab selected={set} onSelect={setSet} />
        </TabsContent>
        <TabsContent value="plaza" className="pt-3">
          <PickTab scope="plaza" selected={plazaIds} onChange={setPlazaIds} />
        </TabsContent>
        {isWebsite && (
          <TabsContent value="personal" className="pt-3">
            <PickTab
              scope="personal"
              selected={personalIds}
              onChange={setPersonalIds}
            />
          </TabsContent>
        )}
        <TabsContent value="urls" className="space-y-2 pt-3">
          <Textarea
            rows={12}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={m['dash.add.urls_placeholder']()}
            className="font-mono text-xs"
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
          {isWebsite
            ? m['dash.add.submit_website']()
            : m['dash.add.submit_library']()}
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
          <DialogTitle>
            {target.kind === 'website'
              ? m['dash.add.title']()
              : m['dash.add.import_title']()}
          </DialogTitle>
          <DialogDescription>
            {target.kind === 'website'
              ? m['dash.add.description']({ name: target.websiteName })
              : m['dash.add.import_description']()}
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
