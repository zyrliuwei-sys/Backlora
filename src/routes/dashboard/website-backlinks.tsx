import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  Bot,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  LINK_STATUSES,
  OPERATION_STATUSES,
  PROGRESS_STATUSES,
  type LinkStatus,
  type OperationStatus,
  type ProgressStatus,
} from '@/config/backlinks';
import { apiGet, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

import {
  download,
  EmptyRow,
  EnumSelect,
  ExternalLink,
  FilterSelect,
  formatTime,
  PageHeader,
  Pager,
  qs,
  readFileText,
  useWebsiteOptions,
  type WebsiteRecord,
} from './-shared';

type RecordsSearch = {
  websiteId?: string;
  operationStatus?: string;
  progressStatus?: ProgressStatus;
  linkStatus?: string;
  keyword?: string;
  sourceDomain?: string;
  targetDomain?: string;
};

type ListResult = {
  list: WebsiteRecord[];
  pagination: { page: number; pageSize: number; total: number };
  statusCounts: Partial<Record<OperationStatus, number>>;
};

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    for (const k of ['website-records', 'websites', 'dashboard-stats'])
      queryClient.invalidateQueries({ queryKey: [k] });
  };
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="text-sm break-words">{children || '-'}</div>
    </div>
  );
}

function RecordDetailDialog({
  record: r,
  onClose,
}: {
  record: WebsiteRecord | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!r} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m['dash.records.detail']()}</DialogTitle>
        </DialogHeader>
        {r && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Detail label={m['dash.codex.website']()}>{r.websiteName}</Detail>
            <Detail label={m['dash.records.source_domain']()}>
              {r.sourceDomain}
            </Detail>
            <Detail label={m['dash.records.source_url']()}>
              {r.sourceUrl}
            </Detail>
            <Detail label={m['dash.records.target_domain']()}>
              {r.targetDomain}
            </Detail>
            <Detail label={m['dash.records.target_url']()}>
              {r.targetUrl}
            </Detail>
            <Detail label={m['dash.records.description']()}>
              {r.description}
            </Detail>
            <Detail label={m['dash.records.user_notes']()}>
              {r.userNotes}
            </Detail>
            <Detail label={m['dash.records.opportunity']()}>
              {r.backlinkId
                ? m['dash.records.library_entry']()
                : m['dash.records.manual']()}
            </Detail>
            <Detail label={m['dash.records.operation_status']()}>
              {r.operationStatus}
            </Detail>
            <Detail label={m['dash.records.link_status']()}>
              {r.linkStatus}
            </Detail>
            <Detail label={m['dash.records.result_url']()}>
              {r.resultUrl && <ExternalLink href={r.resultUrl} />}
            </Detail>
            <Detail label={m['dash.records.proof']()}>{r.proof}</Detail>
            <Detail label={m['dash.records.needs_user']()}>
              {r.needsUser}
            </Detail>
            <Detail label={m['dash.records.claimed_by']()}>
              {r.claimedBy}
            </Detail>
            <Detail label={m['dash.records.lease_expires']()}>
              {r.leaseExpiresAt ? formatTime(r.leaseExpiresAt) : null}
            </Detail>
            <Detail label={m['dash.records.submitted_at']()}>
              {r.submittedAt ? formatTime(r.submittedAt) : null}
            </Detail>
            <Detail label={m['dash.records.attempts']()}>
              {String(r.attemptCount)}
            </Detail>
            <Detail label={m['dash.records.last_error']()}>
              {r.lastError}
            </Detail>
            <Detail label={m['dash.common.created']()}>
              {formatTime(r.createdAt)}
            </Detail>
            <Detail label={m['dash.common.updated']()}>
              {formatTime(r.updatedAt)}
            </Detail>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RecordForm = {
  websiteId: string;
  sourceUrl: string;
  targetUrl: string;
  operationStatus: OperationStatus;
  linkStatus: LinkStatus;
  description: string;
  userNotes: string;
};

function RecordFormDialog({
  open,
  onOpenChange,
  editing,
  defaultWebsiteId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: WebsiteRecord | null;
  defaultWebsiteId?: string;
}) {
  const invalidate = useInvalidate();
  const sites = useWebsiteOptions();
  const [f, setF] = useState<RecordForm>({
    websiteId: '',
    sourceUrl: '',
    targetUrl: '',
    operationStatus: 'pending',
    linkStatus: 'unknown',
    description: '',
    userNotes: '',
  });
  useEffect(() => {
    if (!open) return;
    const siteId =
      editing?.websiteId ?? defaultWebsiteId ?? sites.data?.[0]?.id ?? '';
    setF({
      websiteId: siteId,
      sourceUrl:
        editing?.sourceUrl ??
        sites.data?.find((s) => s.id === siteId)?.url ??
        '',
      targetUrl: editing?.targetUrl ?? '',
      operationStatus: editing?.operationStatus ?? 'pending',
      linkStatus: editing?.linkStatus ?? 'unknown',
      description: editing?.description ?? '',
      userNotes: editing?.userNotes ?? '',
    });
  }, [open, editing, defaultWebsiteId, sites.data]);
  const set = <K extends keyof RecordForm>(k: K, v: RecordForm[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiPost('/api/website/backlinks/edit', { id: editing.id, ...f })
        : apiPost('/api/website/backlink', f),
    onSuccess: () => {
      toast.success(m['dash.common.saved']());
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? m['dash.common.edit']() : m['dash.records.add']()}
          </DialogTitle>
          {editing && (
            <DialogDescription>{editing.sourceUrl}</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{m['dash.codex.website']()}</Label>
            <Select
              value={f.websiteId}
              disabled={!!editing}
              onValueChange={(v) => {
                const id = String(v ?? '');
                setF((p) => ({
                  ...p,
                  websiteId: id,
                  sourceUrl:
                    sites.data?.find((s) => s.id === id)?.url ?? p.sourceUrl,
                }));
              }}
              items={(sites.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{m['dash.records.opportunity']()}</Label>
            <p className="text-muted-foreground text-sm">
              {editing?.backlinkId
                ? m['dash.records.library_entry']()
                : m['dash.records.manual_hint']()}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{m['dash.records.source_url']()}</Label>
            <Input
              value={f.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{m['dash.records.target_url']()}</Label>
            <Input
              value={f.targetUrl}
              onChange={(e) => set('targetUrl', e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{m['dash.records.operation_status']()}</Label>
              <EnumSelect
                value={f.operationStatus}
                options={OPERATION_STATUSES}
                onChange={(v) => set('operationStatus', v)}
              />
            </div>
            <div className="space-y-2">
              <Label>{m['dash.records.link_status']()}</Label>
              <EnumSelect
                value={f.linkStatus}
                options={LINK_STATUSES}
                onChange={(v) => set('linkStatus', v)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{m['dash.records.description']()}</Label>
            <Input
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={m['dash.records.description_placeholder']()}
            />
          </div>
          <div className="space-y-2">
            <Label>{m['dash.records.user_notes']()}</Label>
            <Textarea
              rows={3}
              value={f.userNotes}
              onChange={(e) => set('userNotes', e.target.value)}
              placeholder={m['dash.records.user_notes_placeholder']()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['dash.common.cancel']()}
          </Button>
          <Button
            disabled={save.isPending || !f.websiteId || !f.targetUrl.trim()}
            onClick={() => save.mutate()}
          >
            {m['dash.common.save']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportRecordsDialog({
  open,
  onOpenChange,
  websiteId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  websiteId?: string;
}) {
  const invalidate = useInvalidate();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: () =>
      apiPost<{ created: number; skipped: number; invalid: number }>(
        '/api/website/backlinks/import',
        { text, websiteId }
      ),
    onSuccess: (r) => {
      toast.success(m['dash.plaza.imported'](r));
      invalidate();
      setText('');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m['dash.records.import_title']()}</DialogTitle>
          <DialogDescription>
            {m['dash.records.import_desc']()}
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">{`website,target_url,operation_status,link_status,description,user_notes
DeckCraft,https://example-directory.com/submit,submitted,unknown,,`}</pre>
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="field-sizing-fixed h-64 font-mono text-xs"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setText(await readFileText(file));
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        />
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" />
            {m['dash.common.choose_file']()}
          </Button>
          <Button
            disabled={!text.trim() || run.isPending}
            onClick={() => run.mutate()}
          >
            {m['dash.common.import']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 说明 edited in place; saved when the input loses focus. */
function InlineNote({ record }: { record: WebsiteRecord }) {
  const invalidate = useInvalidate();
  const [v, setV] = useState(record.description);
  useEffect(() => setV(record.description), [record.description]);
  return (
    <Input
      className="h-9 w-[150px]"
      value={v}
      placeholder={m['dash.records.description_placeholder']()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v === record.description) return;
        apiPost('/api/website/backlinks/edit', {
          id: record.id,
          description: v,
        })
          .then(invalidate)
          .catch((e: Error) => toast.error(e.message));
      }}
    />
  );
}

const progressLabel: Record<ProgressStatus, () => string> = {
  doing: () => m['dash.websites.in_progress'](),
  done: () => m['dash.home.done'](),
  failed: () => m['dash.websites.failed'](),
};

/** The 操作 select holds an operation status, or `progress:<doing|done|failed>`. */
function statusFromSearch(search: RecordsSearch) {
  if (search.progressStatus) return `progress:${search.progressStatus}`;
  return search.operationStatus ?? 'all';
}

function RecordsPage() {
  const search = Route.useSearch();
  const invalidate = useInvalidate();
  const { confirm, dialog } = useConfirm();
  const sites = useWebsiteOptions();
  const [websiteId, setWebsiteId] = useState(search.websiteId ?? 'all');
  const [agentOnly, setAgentOnly] = useState(false);
  const [status, setStatus] = useState(statusFromSearch(search));
  const [linkStatus, setLinkStatus] = useState(search.linkStatus ?? 'all');
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? '');
  const [keyword, setKeyword] = useState(search.keyword ?? '');
  const [sourceDomain, setSourceDomain] = useState(search.sourceDomain ?? '');
  const [targetDomain, setTargetDomain] = useState(search.targetDomain ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<WebsiteRecord | null>(null);
  const [editing, setEditing] = useState<WebsiteRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => {
    setWebsiteId(search.websiteId ?? 'all');
    setStatus(statusFromSearch(search));
    setLinkStatus(search.linkStatus ?? 'all');
    setKeyword(search.keyword ?? '');
    setKeywordDraft(search.keyword ?? '');
    setSourceDomain(search.sourceDomain ?? '');
    setTargetDomain(search.targetDomain ?? '');
    setPage(1);
  }, [search]);

  const progressStatus = status.startsWith('progress:')
    ? status.slice(9)
    : undefined;
  const filters = {
    websiteId,
    operationStatus: progressStatus ? undefined : status,
    progressStatus,
    linkStatus,
    keyword,
    sourceDomain,
    targetDomain,
    agentOnly,
  };
  const list = useQuery({
    queryKey: ['website-records', filters, page, pageSize],
    queryFn: () =>
      apiGet<ListResult>(
        `/api/website/backlinks?${qs({ ...filters, page, pageSize })}`
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const rows = list.data?.list ?? [];

  const patch = (id: string, body: object) =>
    apiPost('/api/website/backlinks/edit', { id, ...body })
      .then(invalidate)
      .catch((e: Error) => toast.error(e.message));
  const batch = useMutation({
    mutationFn: (body: object) =>
      apiPost<{ updated: number }>('/api/website/backlinks/batch-edit', {
        ids: [...selected],
        ...body,
      }),
    onSuccess: (r) => {
      toast.success(m['dash.records.batch_updated']({ count: r.updated }));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const checkLinks = useMutation({
    mutationFn: async (ids: string[]) => {
      let checked = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += 20) {
        const r = await apiPost<{ checked: number; failed: number }>(
          '/api/website/backlinks/check-links',
          { ids: ids.slice(i, i + 20) }
        );
        checked += r.checked;
        failed += r.failed;
        invalidate();
      }
      return { checked, failed };
    },
    onSuccess: (r) => {
      toast.success(m['dash.records.check_done']({ count: r.checked }));
      if (r.failed)
        toast.warning(m['dash.records.check_failed']({ count: r.failed }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) =>
      apiPost('/api/website/backlinks/batch-delete', { ids }),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      setSelected(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
      setSelected(new Set());
    };
  const counts = list.data?.statusCounts ?? {};
  const selectedSite =
    websiteId === 'all'
      ? undefined
      : sites.data?.find((s) => s.id === websiteId);
  const domainFilters = [
    [m['dash.records.source_domain'](), sourceDomain, setSourceDomain],
    [m['dash.records.target_domain'](), targetDomain, setTargetDomain],
  ] as const;

  return (
    <>
      <PageHeader
        title={m['dash.records.title']()}
        description={m['dash.records.description_text']()}
      />
      {selectedSite && (
        <section className="bg-card rounded-lg border p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">
                {m['dash.records.stats_title']()}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {selectedSite.name} · {m['dash.records.stats_desc']()}
              </p>
            </div>
            <span className="text-muted-foreground text-sm">
              {m['dash.records.stats_total']({
                count: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0),
              })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {OPERATION_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={status === st}
                aria-label={`${m['dash.records.operation_status']()}: ${st}`}
                onClick={() => resetPage(setStatus)(status === st ? 'all' : st)}
                className={cn(
                  'bg-background hover:bg-muted/50 focus-visible:ring-ring cursor-pointer rounded-md border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  status === st &&
                    'border-primary bg-primary/5 ring-primary ring-1'
                )}
              >
                <span className="text-muted-foreground block truncate text-xs">
                  {st}
                </span>
                <span className="mt-1 block text-2xl font-semibold tabular-nums">
                  {counts[st] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={websiteId}
          onChange={resetPage(setWebsiteId)}
          allLabel={m['dash.records.all_websites']()}
          options={(sites.data ?? []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
        <Button
          variant={agentOnly ? 'default' : 'outline'}
          onClick={() => resetPage(setAgentOnly)(!agentOnly)}
        >
          <Bot className="size-4" />
          codex
        </Button>
        <span className="text-sm font-medium">
          {m['dash.records.operation']()}
        </span>
        <FilterSelect
          value={status}
          onChange={resetPage(setStatus)}
          allLabel={m['dash.common.all_statuses']()}
          options={[
            ...PROGRESS_STATUSES.map((p) => ({
              value: `progress:${p}`,
              label: progressLabel[p](),
            })),
            ...OPERATION_STATUSES.map((s) => ({
              value: s,
              label: `${s} (${counts[s] ?? 0})`,
            })),
          ]}
        />
        <span className="text-sm font-medium">{m['dash.records.link']()}</span>
        <FilterSelect
          value={linkStatus}
          onChange={resetPage(setLinkStatus)}
          allLabel={m['dash.common.all_statuses']()}
          options={LINK_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            resetPage(setKeyword)(keywordDraft.trim());
          }}
        >
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            className="h-9 w-56 pl-8"
            value={keywordDraft}
            placeholder={m['dash.records.keyword_placeholder']()}
            onChange={(e) => setKeywordDraft(e.target.value)}
            onBlur={() =>
              keywordDraft.trim() !== keyword &&
              resetPage(setKeyword)(keywordDraft.trim())
            }
          />
        </form>
        {domainFilters.map(([label, value, set]) =>
          value ? (
            <Badge key={label} variant="secondary" className="h-7 gap-1">
              {label}: {value}
              <button
                type="button"
                aria-label={m['dash.common.clear']()}
                onClick={() => resetPage(set)('')}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : null
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={m['dash.records.refresh']()}
            onClick={() => list.refetch()}
          >
            <RefreshCw
              className={cn('size-4', list.isFetching && 'animate-spin')}
            />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={m['dash.records.import_csv']()}
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={m['dash.records.export_csv']()}
            onClick={() =>
              download(`/api/website/backlinks/export?${qs(filters)}`)
            }
          >
            <Download className="size-4" />
          </Button>
          <Button
            size="icon"
            aria-label={m['dash.records.add']()}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
          {m['dash.common.selected']({ count: selected.size })}
          <span className="text-muted-foreground ml-2">
            {m['dash.records.operation']()}
          </span>
          <EnumSelect
            value={'pending' as OperationStatus}
            options={OPERATION_STATUSES}
            onChange={(v) => batch.mutate({ operationStatus: v })}
          />
          <span className="text-muted-foreground">
            {m['dash.records.link']()}
          </span>
          <EnumSelect
            value={'unknown' as LinkStatus}
            options={LINK_STATUSES}
            onChange={(v) => batch.mutate({ linkStatus: v })}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={checkLinks.isPending}
            onClick={() => checkLinks.mutate([...selected])}
          >
            <RefreshCw
              className={cn('size-4', checkLinks.isPending && 'animate-spin')}
            />
            {m['dash.records.check_links']()}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (
                await confirm({
                  title: m['dash.records.delete_title'](),
                  description: m['dash.records.delete_many']({
                    count: selected.size,
                  }),
                  destructive: true,
                })
              )
                remove.mutate([...selected]);
            }}
          >
            {m['dash.common.delete']()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            {m['dash.add.clear_selection']()}
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={() =>
                    setSelected(
                      allChecked ? new Set() : new Set(rows.map((r) => r.id))
                    )
                  }
                />
              </TableHead>
              <TableHead>{m['dash.records.source_domain']()}</TableHead>
              <TableHead>{m['dash.records.target_domain']()}</TableHead>
              <TableHead>{m['dash.records.operation_status']()}</TableHead>
              <TableHead>{m['dash.records.description']()}</TableHead>
              <TableHead>{m['dash.records.link_status']()}</TableHead>
              <TableHead>{m['dash.common.updated']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.isPending && rows.length === 0 && (
              <EmptyRow colSpan={8} text={m['dash.records.empty']()} />
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.sourceDomain}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <ExternalLink href={r.targetUrl} className="text-foreground">
                    {r.targetDomain}
                  </ExternalLink>
                  {r.targetUrl.replace(/\/$/, '') !==
                    `https://${r.targetDomain}` && (
                    <div className="text-primary truncate text-xs">
                      {r.targetUrl}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <EnumSelect
                    value={r.operationStatus}
                    options={OPERATION_STATUSES}
                    onChange={(v) => patch(r.id, { operationStatus: v })}
                  />
                </TableCell>
                <TableCell>
                  <InlineNote record={r} />
                </TableCell>
                <TableCell>
                  <EnumSelect
                    value={r.linkStatus}
                    options={LINK_STATUSES}
                    onChange={(v) => patch(r.id, { linkStatus: v })}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal tabular-nums">
                    {formatTime(r.updatedAt)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewing(r)}
                    >
                      <Eye className="size-4" />
                      {m['dash.records.detail']()}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'icon' }),
                          'size-8'
                        )}
                        aria-label={m['dash.common.actions']()}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(r);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil />
                          {m['dash.common.edit']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={checkLinks.isPending}
                          onClick={() => checkLinks.mutate([r.id])}
                        >
                          <RefreshCw />
                          {m['dash.records.check_links']()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: m['dash.records.delete_title'](),
                                description: r.targetUrl,
                                destructive: true,
                              })
                            )
                              remove.mutate([r.id]);
                          }}
                        >
                          <Trash2 />
                          {m['dash.common.delete']()}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
        onPage={(p) => {
          setPage(p);
          setSelected(new Set());
        }}
        onPageSize={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
      <RecordDetailDialog record={viewing} onClose={() => setViewing(null)} />
      <RecordFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultWebsiteId={websiteId === 'all' ? undefined : websiteId}
      />
      <ImportRecordsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        websiteId={websiteId === 'all' ? undefined : websiteId}
      />
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/website-backlinks')({
  validateSearch: (s: Record<string, unknown>): RecordsSearch => {
    const text = (v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const progress = text(s.progressStatus);
    return {
      websiteId: text(s.websiteId),
      operationStatus: text(s.operationStatus),
      progressStatus: PROGRESS_STATUSES.find((p) => p === progress),
      linkStatus: text(s.linkStatus),
      keyword: text(s.keyword) ?? text(s.search),
      sourceDomain: text(s.sourceDomain),
      targetDomain: text(s.targetDomain),
    };
  },
  component: RecordsPage,
});
