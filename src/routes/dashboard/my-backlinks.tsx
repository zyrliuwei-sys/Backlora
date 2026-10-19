import { useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Bot, Lock, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { QUALITIES, type BacklinkCategory } from '@/config/backlinks';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { AddBacklinksDialog } from './-add-backlinks';
import { MyBacklinkDialog } from './-backlink-dialogs';
import { CodexDialog } from './-codex-dialog';
import {
  categoryLabel,
  costLabel,
  EmptyRow,
  ExternalLink,
  FilterSelect,
  PageHeader,
  Pager,
  qs,
  qualityLabel,
  type MyBacklink,
  type Paged,
} from './-shared';

function MyBacklinksPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [quality, setQuality] = useState('all');
  const [enabled, setEnabled] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<MyBacklink | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);

  const list = useQuery({
    queryKey: ['my-backlinks', search, quality, enabled, page, pageSize],
    queryFn: () =>
      apiGet<Paged<MyBacklink>>(
        `/api/my-backlinks?${qs({ search, quality, enabled, page, pageSize })}`
      ),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['my-backlinks'] });
    queryClient.invalidateQueries({ queryKey: ['favorites'] });
    queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/my-backlinks/${id}`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: () => apiPost('/api/my-backlinks/clear'),
    onSuccess: () => {
      toast.success(m['dash.my.cleared']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data?.list ?? [];
  return (
    <>
      <PageHeader
        title={m['dash.my.title']()}
        description={m['dash.my.description']()}
        actions={
          <>
            <Button variant="outline" onClick={() => setCodexOpen(true)}>
              <Bot className="size-4" />
              Codex
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              disabled={clear.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: m['dash.my.clear_title'](),
                    description: m['dash.my.clear_desc'](),
                    destructive: true,
                  })
                )
                  clear.mutate();
              }}
            >
              <Trash2 className="size-4" />
              {m['dash.my.clear']()}
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              {m['dash.my.batch_import']()}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {m['dash.my.add']()}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-full sm:w-[340px]"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSearch(input.trim());
              setPage(1);
            }
          }}
          placeholder={m['dash.my.search_placeholder']()}
        />
        <Button
          variant="outline"
          onClick={() => {
            setSearch(input.trim());
            setPage(1);
          }}
        >
          <Search className="size-4" />
          {m['dash.common.search']()}
        </Button>
        <span className="text-sm font-medium">{m['dash.my.quality']()}</span>
        <FilterSelect
          value={quality}
          onChange={(v) => {
            setQuality(v);
            setPage(1);
          }}
          allLabel={m['dash.my.all_qualities']()}
          options={QUALITIES.map((q) => ({
            value: q,
            label: qualityLabel[q](),
          }))}
        />
        <span className="text-sm font-medium">{m['dash.common.status']()}</span>
        <FilterSelect
          value={enabled}
          onChange={(v) => {
            setEnabled(v);
            setPage(1);
          }}
          allLabel={m['dash.common.all_statuses']()}
          options={[
            { value: 'enabled', label: m['dash.common.enabled']() },
            { value: 'disabled', label: m['dash.common.disabled']() },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m['dash.my.backlink']()}</TableHead>
              <TableHead>{m['dash.common.category']()}</TableHead>
              <TableHead>{m['dash.my.quality']()}</TableHead>
              <TableHead>{m['dash.my.my_notes']()}</TableHead>
              <TableHead>{m['dash.common.status']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!list.isPending && rows.length === 0 && (
              <EmptyRow colSpan={6} text={m['dash.my.empty']()} />
            )}
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="max-w-[520px]">
                  <div className="font-medium">{b.name}</div>
                  <ExternalLink href={b.link} className="text-sm" />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>
                    {categoryLabel[b.category as BacklinkCategory]?.() ??
                      b.category}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {b.language || '–'} · {costLabel[b.costType]()}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="font-normal">
                      {qualityLabel[b.personalQuality]()}
                    </Badge>
                    <Badge variant="outline" className="gap-1 font-normal">
                      {b.visibility === 'private' && (
                        <Lock className="size-3" />
                      )}
                      {b.visibility === 'private'
                        ? m['dash.my.private']()
                        : m['dash.my.public']()}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell
                  className="text-muted-foreground max-w-[220px] truncate text-sm"
                  title={b.notes}
                >
                  {b.notes || '-'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div>
                    {b.enabled
                      ? m['dash.common.enabled']()
                      : m['dash.common.disabled']()}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {b.status}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: m['dash.my.remove_title'](),
                            description: m['dash.my.remove_desc']({
                              name: b.name,
                            }),
                            destructive: true,
                          })
                        )
                          remove.mutate(b.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
      <MyBacklinkDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
      <AddBacklinksDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        target={{ kind: 'library' }}
      />
      <CodexDialog
        open={codexOpen}
        onOpenChange={setCodexOpen}
        defaultSource="personal"
      />
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/my-backlinks')({
  component: MyBacklinksPage,
});
