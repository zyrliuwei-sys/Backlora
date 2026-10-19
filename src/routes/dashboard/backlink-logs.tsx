import { useEffect, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { LOG_ACTIONS, LOG_VISIBILITIES } from '@/config/backlinks';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  EmptyRow,
  ExternalLink,
  FilterSelect,
  formatTime,
  PageHeader,
  Pager,
  qs,
  useDebounced,
  useWebsiteOptions,
  type Backlink,
  type Paged,
} from './-shared';

type Log = {
  id: string;
  action: string;
  notes: string;
  status: string;
  visibility: string;
  createdAt: string;
  backlinkId: string;
  backlinkName: string;
  backlinkLink: string;
  websiteId: string | null;
  websiteName: string | null;
};

const visibilityLabel = (v: string) =>
  v === 'public' ? m['dash.logs.public']() : m['dash.logs.private']();

function AddLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const sites = useWebsiteOptions();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [backlinkId, setBacklinkId] = useState('');
  const [websiteId, setWebsiteId] = useState('none');
  const [action, setAction] = useState<string>('comment');
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<string>('private');
  useEffect(() => {
    if (open) {
      setQ('');
      setBacklinkId('');
      setWebsiteId('none');
      setAction('comment');
      setNotes('');
      setVisibility('private');
    }
  }, [open]);
  const options = useQuery({
    queryKey: ['log-backlink-options', debounced],
    queryFn: () =>
      apiGet<Paged<Backlink>>(
        `/api/backlinks?${qs({ search: debounced, page: 1, pageSize: 20 })}`
      ),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: () =>
      apiPost('/api/backlink-logs', {
        backlinkId,
        websiteId: websiteId === 'none' ? undefined : websiteId,
        action,
        notes,
        visibility,
      }),
    onSuccess: () => {
      toast.success(m['dash.common.saved']());
      queryClient.invalidateQueries({ queryKey: ['backlink-logs'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const items = options.data?.list ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m['dash.logs.add']()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{m['dash.logs.backlink']()}</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={m['dash.add.search_placeholder']()}
            />
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {items.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  onClick={() => setBacklinkId(b.id)}
                  className={`hover:bg-muted block w-full truncate px-3 py-1.5 text-left text-sm ${backlinkId === b.id ? 'bg-primary/10 text-primary' : ''}`}
                >
                  {b.name}{' '}
                  <span className="text-muted-foreground">· {b.domain}</span>
                </button>
              ))}
              {items.length === 0 && (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  {m['dash.common.empty']()}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{m['dash.codex.website']()}</Label>
              <Select
                value={websiteId}
                onValueChange={(v) => setWebsiteId(String(v ?? 'none'))}
                items={[
                  { value: 'none', label: '-' },
                  ...(sites.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  {(sites.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{m['dash.logs.action']()}</Label>
              <Select
                value={action}
                onValueChange={(v) => v && setAction(String(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{m['dash.logs.notes']()}</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{m['dash.logs.visibility']()}</Label>
            <Select
              value={visibility}
              onValueChange={(v) => v && setVisibility(String(v))}
              items={LOG_VISIBILITIES.map((v) => ({
                value: v,
                label: visibilityLabel(v),
              }))}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_VISIBILITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {visibilityLabel(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['dash.common.cancel']()}
          </Button>
          <Button
            disabled={!backlinkId || save.isPending}
            onClick={() => save.mutate()}
          >
            {m['dash.common.save']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogsPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const sites = useWebsiteOptions();
  const [websiteId, setWebsiteId] = useState(
    Route.useSearch().websiteId ?? 'all'
  );
  const [action, setAction] = useState('all');
  const [status, setStatus] = useState('all');
  const [visibility, setVisibility] = useState('all');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: [
      'backlink-logs',
      websiteId,
      action,
      status,
      visibility,
      debounced,
      page,
      pageSize,
    ],
    queryFn: () =>
      apiGet<Paged<Log>>(
        `/api/backlink-logs?${qs({ websiteId, action, status, visibility, search: debounced, page, pageSize })}`
      ),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/backlink-logs/${id}`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      queryClient.invalidateQueries({ queryKey: ['backlink-logs'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = list.data?.list ?? [];
  const reset =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  return (
    <>
      <PageHeader
        title={m['dash.logs.title']()}
        description={m['dash.logs.description']()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={websiteId}
          onChange={reset(setWebsiteId)}
          allLabel={m['dash.records.all_websites']()}
          options={(sites.data ?? []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
        <span className="text-sm font-medium">{m['dash.logs.action']()}</span>
        <FilterSelect
          value={action}
          onChange={reset(setAction)}
          allLabel={m['dash.logs.all_actions']()}
          options={LOG_ACTIONS.map((a) => ({ value: a, label: a }))}
        />
        <span className="text-sm font-medium">{m['dash.common.status']()}</span>
        <FilterSelect
          value={status}
          onChange={reset(setStatus)}
          allLabel={m['dash.common.all_statuses']()}
          options={[{ value: 'active', label: 'active' }]}
        />
        <span className="text-sm font-medium">
          {m['dash.logs.visibility']()}
        </span>
        <FilterSelect
          value={visibility}
          onChange={reset(setVisibility)}
          allLabel={m['dash.logs.all_visibility']()}
          options={LOG_VISIBILITIES.map((v) => ({
            value: v,
            label: visibilityLabel(v),
          }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          className="h-9 w-full sm:w-[380px]"
          value={search}
          onChange={(e) => reset(setSearch)(e.target.value)}
          placeholder={m['dash.logs.search_placeholder']()}
        />
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {m['dash.logs.add']()}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m['dash.logs.backlink']()}</TableHead>
              <TableHead>{m['dash.codex.website']()}</TableHead>
              <TableHead>{m['dash.logs.action']()}</TableHead>
              <TableHead>{m['dash.logs.notes']()}</TableHead>
              <TableHead>{m['dash.common.status']()}</TableHead>
              <TableHead>{m['dash.logs.visibility']()}</TableHead>
              <TableHead>{m['dash.common.created']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.isPending && rows.length === 0 && (
              <EmptyRow colSpan={8} text={m['dash.logs.empty']()} />
            )}
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-[260px]">
                  <div className="font-medium">{l.backlinkName}</div>
                  <ExternalLink href={l.backlinkLink} className="text-xs" />
                </TableCell>
                <TableCell>{l.websiteName ?? '-'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {l.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[320px] text-sm">
                  {l.notes || '-'}
                </TableCell>
                <TableCell>{l.status}</TableCell>
                <TableCell>{visibilityLabel(l.visibility)}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatTime(l.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: m['dash.logs.delete_title'](),
                          destructive: true,
                        })
                      )
                        remove.mutate(l.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
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
      <AddLogDialog open={open} onOpenChange={setOpen} />
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/backlink-logs')({
  validateSearch: (s: Record<string, unknown>): { websiteId?: string } => ({
    websiteId:
      typeof s.websiteId === 'string' && s.websiteId ? s.websiteId : undefined,
  }),
  component: LogsPage,
});
