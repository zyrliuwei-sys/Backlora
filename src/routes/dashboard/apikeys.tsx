import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type PageResult,
} from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { useConfirm } from '@/hooks/use-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { EmptyRow, formatTime, PageHeader } from './-shared';

interface ApiKeyRow {
  id: string;
  keyPrefix: string;
  key: string | null;
  title: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

function mask(k: ApiKeyRow) {
  return k.key
    ? `${k.key.slice(0, 8)}...${k.key.slice(-4)}`
    : `${k.keyPrefix}…`;
}

function ApiKeysPage() {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [title, setTitle] = useState('');
  const keys = useQuery({
    queryKey: ['apikeys', 'all'],
    queryFn: () =>
      apiGet<PageResult<ApiKeyRow>>('/api/apikeys?page=1&pageSize=100'),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['apikeys'] });

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ key: string }>('/api/apikeys', {
        title: title.trim() || 'API Key',
      }),
    onSuccess: async (r) => {
      setTitle('');
      invalidate();
      try {
        await navigator.clipboard.writeText(r.key);
        toast.success(m['dash.keys.created_copied']());
      } catch {
        toast.success(m['dash.keys.created']());
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'disabled' }) =>
      apiPatch('/api/apikeys', v),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/apikeys?id=${id}`),
    onSuccess: () => {
      toast.success(m['dash.common.deleted']());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copy(k: ApiKeyRow) {
    if (!k.key) return;
    try {
      await navigator.clipboard.writeText(k.key);
      toast.success(m['dash.keys.copied']());
    } catch {
      toast.error(m['dash.codex.copy_failed']());
    }
  }

  const rows = keys.data?.items ?? [];
  return (
    <>
      <PageHeader
        title={m['dash.keys.title']()}
        description={m['dash.keys.description']()}
      />
      <Card>
        <CardContent className="space-y-3">
          <div>
            <div className="font-semibold">{m['dash.keys.generate']()}</div>
            <div className="text-muted-foreground text-sm">
              {m['dash.keys.generate_desc']()}
            </div>
          </div>
          <form
            className="flex max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={m['dash.keys.title_placeholder']()}
            />
            <Button type="submit" disabled={create.isPending}>
              {m['dash.keys.generate_button']()}
            </Button>
          </form>
          <p className="text-muted-foreground text-xs">
            {m['dash.keys.header_hint']()}
          </p>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m['dash.keys.col_title']()}</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>{m['dash.common.status']()}</TableHead>
              <TableHead>{m['dash.common.created']()}</TableHead>
              <TableHead className="text-right">
                {m['dash.common.actions']()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!keys.isPending && rows.length === 0 && (
              <EmptyRow colSpan={5} text={m['dash.keys.empty']()} />
            )}
            {rows.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="max-w-[420px] truncate">
                  {k.title}
                </TableCell>
                <TableCell className="font-mono text-xs">{mask(k)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {k.status === 'active'
                      ? m['dash.common.enabled']()
                      : m['dash.common.disabled']()}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatTime(k.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!k.key}
                      onClick={() => copy(k)}
                    >
                      {m['dash.keys.copy']()}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setStatus.mutate({
                          id: k.id,
                          status: k.status === 'active' ? 'disabled' : 'active',
                        })
                      }
                    >
                      {k.status === 'active'
                        ? m['dash.keys.disable']()
                        : m['dash.keys.enable']()}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: m['dash.keys.delete_title'](),
                            description: k.title,
                            destructive: true,
                          })
                        )
                          remove.mutate(k.id);
                      }}
                    >
                      {m['dash.common.delete']()}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog}
    </>
  );
}

export const Route = createFileRoute('/dashboard/apikeys')({
  component: ApiKeysPage,
});
