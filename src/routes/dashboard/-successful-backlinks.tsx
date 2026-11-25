import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import { formatDateTime } from '@/lib/time';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
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

import {
  ExternalLink,
  FilterSelect,
  Pager,
  qs,
  useDebounced,
  useWebsiteOptions,
  type Paged,
  type WebsiteRecord,
} from './-shared';

export function SuccessfulBacklinks() {
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [websiteId, setWebsiteId] = useState('all');
  const search = useDebounced(input.trim());
  const sites = useWebsiteOptions();
  const pageSize = 20;
  const records = useQuery({
    queryKey: ['website-records', 'successful', websiteId, search, page],
    queryFn: () =>
      apiGet<Paged<WebsiteRecord>>(
        `/api/website/backlinks?${qs({ successfulOnly: 1, websiteId, search, page, pageSize })}`
      ),
  });
  const rows = records.data?.list ?? [];
  const total = records.data?.pagination.total ?? 0;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            value={websiteId}
            onChange={(value) => {
              setWebsiteId(value);
              setPage(1);
            }}
            allLabel={m['dash.records.all_websites']()}
            options={(sites.data ?? []).map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
          />
          <Input
            className="max-w-sm"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setPage(1);
            }}
            placeholder={m['dash.common.search']()}
            aria-label={m['dash.common.search']()}
          />
        </div>

        {records.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {m['dash.add.load_error']()}
          </p>
        ) : records.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {m['dash.common.loading']()}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m['dash.my.success_empty']()}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m['dash.codex.website']()}</TableHead>
                  <TableHead>{m['dash.my.link']()}</TableHead>
                  <TableHead>{m['dash.records.operation_status']()}</TableHead>
                  <TableHead>{m['dash.records.result_url']()}</TableHead>
                  <TableHead>{m['dash.records.submitted_at']()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.websiteName || row.sourceDomain}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <ExternalLink href={row.targetUrl} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.operationStatus === 'live'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {row.operationStatus === 'live'
                          ? m['dash.my.success_live']()
                          : m['dash.my.success_submitted']()}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64">
                      {row.resultUrl ? (
                        <ExternalLink href={row.resultUrl} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDateTime(row.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > pageSize && (
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
          />
        )}
      </CardContent>
    </Card>
  );
}
