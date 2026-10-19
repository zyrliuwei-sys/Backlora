import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink as OpenIcon, Search } from 'lucide-react';

import { BACKLINK_CATEGORIES } from '@/config/backlinks';
import { apiGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import {
  categoryLabel,
  EmptyRow,
  FilterSelect,
  PageHeader,
  Pager,
  qs,
  useFacets,
  useWebsiteOptions,
  type Backlink,
  type MyBacklink,
  type Paged,
  type WebsiteRecord,
} from './-shared';

type Source = 'plaza' | 'personal' | 'records';
type Row = {
  id: string;
  name: string;
  url: string;
  extra: string;
  dr: number | null;
};

function isUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function QuickOpenPage() {
  const [source, setSource] = useState<Source>('plaza');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('all');
  const [websiteId, setWebsiteId] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [text, setText] = useState('');
  const [batch, setBatch] = useState(10);
  const [interval, setIntervalMs] = useState(100);
  const [removeOpened, setRemoveOpened] = useState(true);
  const facets = useFacets('plaza');
  const sites = useWebsiteOptions();

  const list = useQuery({
    queryKey: [
      'quick-open',
      source,
      search,
      category,
      tag,
      websiteId,
      page,
      pageSize,
    ],
    queryFn: async (): Promise<{ rows: Row[]; total: number }> => {
      if (source === 'plaza') {
        const r = await apiGet<Paged<Backlink>>(
          `/api/backlinks?${qs({ search, category, tag, page, pageSize })}`
        );
        return {
          rows: r.list.map((b) => ({
            id: b.id,
            name: b.name,
            url: b.link,
            extra: categoryLabel[b.category](),
            dr: b.dr,
          })),
          total: r.pagination.total,
        };
      }
      if (source === 'personal') {
        const r = await apiGet<Paged<MyBacklink>>(
          `/api/my-backlinks?${qs({ search, page, pageSize })}`
        );
        return {
          rows: r.list.map((b) => ({
            id: b.id,
            name: b.name,
            url: b.link,
            extra: categoryLabel[b.category](),
            dr: b.dr,
          })),
          total: r.pagination.total,
        };
      }
      const r = await apiGet<Paged<WebsiteRecord>>(
        `/api/website/backlinks?${qs({ websiteId, search, page, pageSize })}`
      );
      return {
        rows: r.list.map((x) => ({
          id: x.id,
          name: x.targetDomain,
          url: x.targetUrl,
          extra: x.operationStatus,
          dr: null,
        })),
        total: r.pagination.total,
      };
    },
    placeholderData: keepPreviousData,
  });

  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text]
  );
  const valid = useMemo(() => [...new Set(lines.filter(isUrl))], [lines]);
  const invalidCount = lines.filter((l) => !isUrl(l)).length;
  const inList = new Set(lines);
  const rows = list.data?.rows ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => inList.has(r.url));

  const setUrls = (urls: string[]) => setText(urls.join('\n'));
  const toggle = (url: string) =>
    setUrls(inList.has(url) ? lines.filter((l) => l !== url) : [...lines, url]);

  function openBatch() {
    const current = valid.slice(0, batch);
    current.forEach((u, i) => {
      setTimeout(() => window.open(u, '_blank', 'noopener'), i * interval);
    });
    if (removeOpened) {
      const opened = new Set(current);
      setUrls(lines.filter((l) => !opened.has(l)));
    }
  }

  const changeSource = (s: Source) => {
    setSource(s);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title={m['dash.quick.title']()}
        description={m['dash.quick.description']()}
      />
      <Card>
        <CardContent className="space-y-4">
          <div>
            <div className="font-semibold">{m['dash.quick.source']()}</div>
            <div className="text-muted-foreground text-sm">
              {m['dash.quick.source_desc']()}
            </div>
          </div>
          <Tabs value={source} onValueChange={(v) => changeSource(v as Source)}>
            <TabsList>
              <TabsTrigger value="plaza">{m['dash.nav.plaza']()}</TabsTrigger>
              <TabsTrigger value="personal">
                {m['dash.nav.my_backlinks']()}
              </TabsTrigger>
              <TabsTrigger value="records">
                {m['dash.quick.website_records']()}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full sm:w-[220px]">
              <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
              <Input
                className="h-9 pl-8"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearch(input.trim());
                    setPage(1);
                  }
                }}
                placeholder={m['dash.common.keyword']()}
              />
            </div>
            {source === 'plaza' && (
              <>
                <FilterSelect
                  value={tag}
                  onChange={(v) => {
                    setTag(v);
                    setPage(1);
                  }}
                  allLabel={m['dash.common.all_tags']()}
                  options={(facets.data?.tags ?? []).map((t) => ({
                    value: t.tag,
                    label: t.tag,
                  }))}
                />
                <FilterSelect
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setPage(1);
                  }}
                  allLabel={m['dash.common.all_categories']()}
                  options={BACKLINK_CATEGORIES.map((c) => ({
                    value: c,
                    label: categoryLabel[c](),
                  }))}
                />
              </>
            )}
            {source === 'records' && (
              <FilterSelect
                value={websiteId}
                onChange={(v) => {
                  setWebsiteId(v);
                  setPage(1);
                }}
                allLabel={m['dash.records.all_websites']()}
                options={(sites.data ?? []).map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
              />
            )}
            <Button
              onClick={() => {
                setSearch(input.trim());
                setPage(1);
              }}
            >
              <Search className="size-4" />
              {m['dash.common.search']()}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setInput('');
                setSearch('');
                setTag('all');
                setCategory('all');
                setWebsiteId('all');
                setPage(1);
              }}
            >
              {m['dash.common.reset']()}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            {m['dash.quick.selected']({
              count: rows.filter((r) => inList.has(r.url)).length,
              total: rows.length,
            })}
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={() =>
                        setUrls(
                          allChecked
                            ? lines.filter(
                                (l) => !rows.some((r) => r.url === l)
                              )
                            : [
                                ...lines,
                                ...rows
                                  .map((r) => r.url)
                                  .filter((u) => !inList.has(u)),
                              ]
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>{m['dash.common.name']()}</TableHead>
                  <TableHead>{m['dash.common.link']()}</TableHead>
                  <TableHead>
                    {source === 'records'
                      ? m['dash.records.operation_status']()
                      : m['dash.common.category']()}
                  </TableHead>
                  <TableHead>DR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!list.isPending && rows.length === 0 && (
                  <EmptyRow colSpan={5} text={m['dash.common.empty']()} />
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox
                        checked={inList.has(r.url)}
                        onCheckedChange={() => toggle(r.url)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-primary max-w-[420px] truncate">
                      {r.url}
                    </TableCell>
                    <TableCell>{r.extra}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.dr ?? '–'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={page}
            pageSize={pageSize}
            total={list.data?.total ?? 0}
            onPage={setPage}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <div className="font-semibold">{m['dash.quick.list']()}</div>
            <div className="text-muted-foreground text-sm">
              {m['dash.quick.list_desc']()}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{m['dash.quick.url_list']()}</Label>
            <Textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={m['dash.quick.url_placeholder']()}
              className="font-mono text-xs"
            />
            <p className="text-muted-foreground text-sm">
              {m['dash.quick.counts']({
                valid: valid.length,
                invalid: invalidCount,
              })}
            </p>
          </div>
          <div className="bg-muted/30 flex flex-wrap items-end gap-4 rounded-lg border p-4">
            <div className="space-y-2">
              <Label>{m['dash.quick.batch']()}</Label>
              <Input
                type="number"
                min={1}
                max={50}
                className="w-[180px]"
                value={batch}
                onChange={(e) =>
                  setBatch(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{m['dash.quick.interval']()}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={5000}
                  className="w-[180px]"
                  value={interval}
                  onChange={(e) =>
                    setIntervalMs(
                      Math.max(0, Math.min(5000, Number(e.target.value) || 0))
                    )
                  }
                />
                <span className="text-muted-foreground text-sm">
                  {m['dash.quick.ms']()}
                </span>
              </div>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox
                checked={removeOpened}
                onCheckedChange={(v) => setRemoveOpened(!!v)}
              />
              {m['dash.quick.remove_opened']()}
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {m['dash.quick.popup_hint']()}
            </p>
            <Button disabled={!valid.length} onClick={openBatch}>
              <OpenIcon className="size-4" />
              {m['dash.quick.open']()}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export const Route = createFileRoute('/dashboard/quick-open')({
  component: QuickOpenPage,
});
