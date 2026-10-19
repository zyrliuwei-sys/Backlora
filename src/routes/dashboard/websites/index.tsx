import { useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  Bot,
  Copy,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Link, useRouter } from '@/core/i18n/navigation';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { AddBacklinksDialog } from '../-add-backlinks';
import { CodexDialog } from '../-codex-dialog';
import {
  EmptyRow,
  ExternalLink,
  FilterSelect,
  PageHeader,
  Pager,
  qs,
  SiteIcon,
  useDebounced,
  type Paged,
  type Website,
} from '../-shared';

function WebsitesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [codexFor, setCodexFor] = useState<string | null>(null);
  const [addFor, setAddFor] = useState<Website | null>(null);

  const list = useQuery({
    queryKey: ['websites', status, debounced, page, pageSize],
    queryFn: () =>
      apiGet<Paged<Website & { counts: NonNullable<Website['counts']> }>>(
        `/api/websites?${qs({ status, search: debounced, page, pageSize })}`
      ),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['websites'] });
    queryClient.invalidateQueries({ queryKey: ['website-options'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };
  const toggleAuto = useMutation({
    mutationFn: (v: { id: string; on: boolean }) =>
      apiPatch(`/api/websites/${v.id}`, { autoBacklinkEnabled: v.on }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const demo = useMutation({
    mutationFn: () => apiPost('/api/websites/demo'),
    onSuccess: () => {
      toast.success(m['dash.websites.demo_created']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => apiPost(`/api/websites/${id}/duplicate`),
    onSuccess: () => {
      toast.success(m['dash.websites.duplicated']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/websites/${id}`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/api/websites/${id}/restore`),
    onSuccess: () => {
      toast.success(m['dash.websites.restored']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const purge = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/websites/${id}?permanent=1`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data?.list ?? [];
  const recordsHref = (id: string) =>
    `/dashboard/website-backlinks?websiteId=${id}`;
  const logsHref = (id: string) => `/dashboard/backlink-logs?websiteId=${id}`;
  const showingDeleted = status === 'deleted';
  const askPurge = async (w: Website) => {
    if (
      await confirm({
        title: m['dash.websites.purge_title'](),
        description: m['dash.websites.purge_desc']({ name: w.name }),
        destructive: true,
      })
    )
      purge.mutate(w.id);
  };
  const askDelete = async (w: Website) => {
    if (
      await confirm({
        title: m['dash.websites.delete_title'](),
        description: m['dash.websites.delete_desc']({ name: w.name }),
        destructive: true,
      })
    )
      remove.mutate(w.id);
  };

  return (
    <>
      <PageHeader
        title={m['dash.websites.title']()}
        description={m['dash.websites.description']()}
        actions={
          <>
            {/* Only an account without websites gets the sample (the API enforces it too). */}
            {list.isSuccess &&
              list.data.pagination.total === 0 &&
              status === 'all' &&
              !search && (
                <Button
                  variant="outline"
                  disabled={demo.isPending}
                  onClick={() => demo.mutate()}
                >
                  {demo.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {m['dash.websites.create_demo']()}
                </Button>
              )}
            <Link href="/dashboard/websites/new" className={buttonVariants()}>
              <Plus className="size-4" />
              {m['dash.websites.new']()}
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{m['dash.common.status']()}</span>
        <FilterSelect
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          allLabel={m['dash.common.all_statuses']()}
          options={[
            { value: 'enabled', label: m['dash.common.enabled']() },
            { value: 'disabled', label: m['dash.common.disabled']() },
            { value: 'deleted', label: m['dash.common.deleted']() },
          ]}
        />
        <Input
          className="h-9 w-full sm:w-[380px]"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={m['dash.websites.search_placeholder']()}
        />
        <span className="text-muted-foreground ml-auto text-sm">
          {m['dash.websites.count']({
            count: list.data?.pagination.total ?? 0,
          })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[64px]">
                {m['dash.websites.icon']()}
              </TableHead>
              <TableHead>{m['dash.common.name']()}</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>{m['dash.websites.auto']()}</TableHead>
              <TableHead>{m['dash.websites.progress']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.isPending && rows.length === 0 && (
              <EmptyRow colSpan={6} text={m['dash.websites.empty']()} />
            )}
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <SiteIcon site={w} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{w.name}</div>
                  {!showingDeleted && (
                    <div className="text-primary mt-1 flex gap-3 text-xs">
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 hover:underline"
                        onClick={() => setCodexFor(w.id)}
                      >
                        <Bot className="size-3.5" />
                        codex
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 hover:underline"
                        onClick={() => setAddFor(w)}
                      >
                        <Plus className="size-3.5" />
                        {m['dash.websites.add']()}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 hover:underline"
                        onClick={() => router.push(recordsHref(w.id))}
                      >
                        <Link2 className="size-3.5" />
                        {m['dash.websites.records']()}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 hover:underline"
                        onClick={() => router.push(logsHref(w.id))}
                      >
                        <ScrollText className="size-3.5" />
                        {m['dash.websites.logs']()}
                      </button>
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <ExternalLink href={w.url} />
                </TableCell>
                <TableCell>
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    {w.autoBacklinkEnabled
                      ? m['dash.common.on']()
                      : m['dash.common.off']()}
                    <Switch
                      checked={w.autoBacklinkEnabled}
                      disabled={showingDeleted}
                      onCheckedChange={(on) =>
                        toggleAuto.mutate({ id: w.id, on })
                      }
                    />
                  </label>
                </TableCell>
                <TableCell>
                  <div className="grid grid-cols-4 gap-6">
                    {(
                      [
                        [m['dash.common.total'](), w.counts.total, ''],
                        [
                          m['dash.websites.in_progress'](),
                          w.counts.inProgress,
                          'doing',
                        ],
                        [m['dash.home.done'](), w.counts.done, 'done'],
                        [
                          m['dash.websites.failed'](),
                          w.counts.failed,
                          'failed',
                        ],
                      ] as const
                    ).map(([label, n, progress]) => (
                      <div key={label} className="min-w-12">
                        <div className="text-muted-foreground text-xs whitespace-nowrap">
                          {label}
                        </div>
                        <Link
                          href={
                            recordsHref(w.id) +
                            (progress && `&progressStatus=${progress}`)
                          }
                          aria-label={`${label}: ${n}`}
                          className="text-primary text-base tabular-nums hover:underline"
                        >
                          {n}
                        </Link>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={
                        buttonVariants({ variant: 'outline', size: 'icon' }) +
                        ' size-8'
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    {showingDeleted ? (
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => restore.mutate(w.id)}>
                          <RotateCcw />
                          {m['dash.websites.restore']()}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => askPurge(w)}
                        >
                          <Trash2 />
                          {m['dash.websites.purge']()}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    ) : (
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            router.push(`/dashboard/websites/${w.id}/edit`)
                          }
                        >
                          <Pencil />
                          {m['dash.common.edit']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => duplicate.mutate(w.id)}
                        >
                          <Copy />
                          {m['dash.websites.duplicate']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCodexFor(w.id)}>
                          <Bot />
                          codex
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAddFor(w)}>
                          <Plus />
                          {m['dash.websites.add']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => router.push(recordsHref(w.id))}
                        >
                          <Link2 />
                          {m['dash.websites.records']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => router.push(logsHref(w.id))}
                        >
                          <ScrollText />
                          {m['dash.websites.logs']()}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => askDelete(w)}
                        >
                          <Trash2 />
                          {m['dash.common.delete']()}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    )}
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pager
        page={page}
        pageSize={pageSize}
        total={list.data?.pagination.total ?? 0}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
      <CodexDialog
        open={!!codexFor}
        onOpenChange={(v) => !v && setCodexFor(null)}
        websiteId={codexFor}
      />
      {addFor && (
        <AddBacklinksDialog
          open={!!addFor}
          onOpenChange={(v) => !v && setAddFor(null)}
          target={{
            kind: 'website',
            websiteId: addFor.id,
            websiteName: addFor.name,
          }}
        />
      )}
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/websites/')({
  component: WebsitesPage,
});
