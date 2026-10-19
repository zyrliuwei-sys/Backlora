import { useRef, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  Bookmark,
  BookmarkCheck,
  Download,
  Eye,
  Globe,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  BACKLINK_CATEGORIES,
  BACKLINK_STATUSES,
  COST_TYPES,
} from '@/config/backlinks';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
  AddToWebsiteDialog,
  BacklinkDetailDialog,
  PlazaBacklinkDialog,
} from './-backlink-dialogs';
import {
  categoryLabel,
  costLabel,
  download,
  EmptyRow,
  ExternalLink,
  FilterSelect,
  PageHeader,
  Pager,
  qs,
  QualityPill,
  readFileText,
  StatusPill,
  TagList,
  useCanManagePlaza,
  useFacets,
  type Backlink,
  type Paged,
} from './-shared';

type Filters = {
  search: string;
  tag: string;
  category: string;
  status: string;
  costType: string;
};
const EMPTY: Filters = {
  search: '',
  tag: 'all',
  category: 'all',
  status: 'all',
  costType: 'all',
};

function ImportPlazaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: () =>
      apiPost<{ created: number; skipped: number; invalid: number }>(
        '/api/backlinks/import',
        { text }
      ),
    onSuccess: (r) => {
      toast.success(m['dash.plaza.imported'](r));
      queryClient.invalidateQueries({ queryKey: ['plaza'] });
      queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
      setText('');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m['dash.plaza.import_title']()}</DialogTitle>
          <DialogDescription>{m['dash.plaza.import_desc']()}</DialogDescription>
        </DialogHeader>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-relaxed">{`name,link,category,tags,cost_type,link_type,dr,organic_traffic,language,confidence,details,tips
BetaList,https://betalist.com/submissions/new,directory,"startup,launch",free,dofollow,76,239460,en,observed,,
SaaSHub,https://www.saashub.com/submit,directory,saas,freemium,dofollow,72,,en,verified,,login required`}</pre>
        <p className="text-muted-foreground text-xs">
          category: {BACKLINK_CATEGORIES.join(' / ')} · cost_type:{' '}
          {COST_TYPES.join(' / ')}
        </p>
        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-xs"
          placeholder={m['dash.plaza.import_placeholder']()}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
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

function PlazaPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const canManage = useCanManagePlaza();
  const facets = useFacets('plaza');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewing, setViewing] = useState<Backlink | null>(null);
  const [addTo, setAddTo] = useState<Backlink | null>(null);
  const [editing, setEditing] = useState<Backlink | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({
    queryKey: ['plaza', filters, page, pageSize],
    queryFn: () =>
      apiGet<Paged<Backlink>>(
        `/api/backlinks?${qs({ ...filters, page, pageSize })}`
      ),
    placeholderData: keepPreviousData,
  });
  const favorites = useQuery({
    queryKey: ['favorites'],
    queryFn: () => apiGet<string[]>('/api/backlink/favorites'),
  });
  const favSet = new Set(favorites.data ?? []);

  const toggleFav = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ favorited: boolean }>('/api/backlink/favorite', {
        backlinkId: id,
      }),
    onSuccess: (r) => {
      toast.success(
        r.favorited
          ? m['dash.plaza.saved_to_library']()
          : m['dash.plaza.removed_from_library']()
      );
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['my-backlinks'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/backlinks/${id}`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      queryClient.invalidateQueries({ queryKey: ['plaza'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = () => {
    setFilters(draft);
    setPage(1);
  };
  const rows = list.data?.list ?? [];

  return (
    <>
      <PageHeader
        title={m['dash.plaza.title']()}
        description={m['dash.plaza.description']()}
        actions={
          canManage && (
            <>
              <Button
                variant="outline"
                onClick={() => download('/api/backlinks/export')}
              >
                <Download className="size-4" />
                {m['dash.common.export']()}
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="size-4" />
                {m['dash.common.import']()}
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" />
                {m['dash.plaza.add']()}
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-[220px]">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input
            className="h-9 pl-8"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder={m['dash.common.keyword']()}
          />
        </div>
        <FilterSelect
          value={draft.tag}
          onChange={(v) => setDraft({ ...draft, tag: v })}
          allLabel={m['dash.common.all_tags']()}
          options={(facets.data?.tags ?? []).map((t) => ({
            value: t.tag,
            label: t.tag,
          }))}
        />
        <FilterSelect
          value={draft.category}
          onChange={(v) => setDraft({ ...draft, category: v })}
          allLabel={m['dash.common.all_categories']()}
          options={BACKLINK_CATEGORIES.map((c) => ({
            value: c,
            label: categoryLabel[c](),
          }))}
        />
        <FilterSelect
          value={draft.status}
          onChange={(v) => setDraft({ ...draft, status: v })}
          allLabel={m['dash.common.all_statuses']()}
          options={BACKLINK_STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          value={draft.costType}
          onChange={(v) => setDraft({ ...draft, costType: v })}
          allLabel={m['dash.plaza.all_costs']()}
          options={COST_TYPES.map((c) => ({ value: c, label: costLabel[c]() }))}
        />
        <Button onClick={apply}>
          <Search className="size-4" />
          {m['dash.common.search']()}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(EMPTY);
            setFilters(EMPTY);
            setPage(1);
          }}
        >
          {m['dash.common.reset']()}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m['dash.common.name']()}</TableHead>
              <TableHead>{m['dash.common.link']()}</TableHead>
              <TableHead>{m['dash.common.tags']()}</TableHead>
              <TableHead>{m['dash.common.status']()}</TableHead>
              <TableHead>{m['dash.plaza.cost']()}</TableHead>
              <TableHead>{m['dash.common.category']()}</TableHead>
              <TableHead>{m['dash.plaza.quality']()}</TableHead>
              <TableHead>DR</TableHead>
              <TableHead>{m['dash.plaza.traffic']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.isPending && rows.length === 0 && (
              <EmptyRow colSpan={10} text={m['dash.plaza.empty']()} />
            )}
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell className="max-w-[260px]">
                  <ExternalLink href={b.link} />
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <TagList tags={b.tags} />
                </TableCell>
                <TableCell>
                  <StatusPill status={b.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {costLabel[b.costType]()}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {categoryLabel[b.category]()}
                </TableCell>
                <TableCell>
                  <QualityPill quality={b.quality} />
                </TableCell>
                <TableCell className="tabular-nums">{b.dr ?? '–'}</TableCell>
                <TableCell className="tabular-nums">
                  {b.organicTraffic?.toLocaleString() ?? '–'}
                </TableCell>
                <TableCell>
                  <div className="text-primary flex justify-end gap-3 text-xs whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:underline"
                      onClick={() => setViewing(b)}
                    >
                      <Eye className="size-3.5" />
                      {m['dash.common.view']()}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:underline"
                      onClick={() => toggleFav.mutate(b.id)}
                    >
                      {favSet.has(b.id) ? (
                        <BookmarkCheck className="size-3.5" />
                      ) : (
                        <Bookmark className="size-3.5" />
                      )}
                      {favSet.has(b.id)
                        ? m['dash.plaza.in_library']()
                        : m['dash.plaza.add_to_library']()}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:underline"
                      onClick={() => setAddTo(b)}
                    >
                      <Globe className="size-3.5" />
                      {m['dash.plaza.add_to_website']()}
                    </button>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={() => {
                            setEditing(b);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                          {m['dash.common.edit']()}
                        </button>
                        <button
                          type="button"
                          className="text-destructive inline-flex items-center gap-1 hover:underline"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: m['dash.plaza.delete_title'](),
                                description: m['dash.plaza.delete_desc']({
                                  name: b.name,
                                }),
                                destructive: true,
                              })
                            )
                              remove.mutate(b.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                          {m['dash.common.delete']()}
                        </button>
                      </>
                    )}
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
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />

      <BacklinkDetailDialog
        backlink={viewing}
        onOpenChange={(v) => !v && setViewing(null)}
      />
      <AddToWebsiteDialog
        backlink={addTo}
        onOpenChange={(v) => !v && setAddTo(null)}
      />
      <PlazaBacklinkDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
      <ImportPlazaDialog open={importOpen} onOpenChange={setImportOpen} />
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/backlinks')({
  component: PlazaPage,
});
