import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, Link2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { PageHeader } from './-shared';

type ImportResult = {
  added: number;
  skipped?: number;
  invalid?: number;
};

type CompletedBatch = ImportResult & {
  name: string;
};

function importLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function MyBacklinksPage() {
  const queryClient = useQueryClient();
  const [batchName, setBatchName] = useState('');
  const [urls, setUrls] = useState('');
  const [completed, setCompleted] = useState<CompletedBatch | null>(null);
  const lines = importLines(urls);

  const importBatch = useMutation({
    mutationFn: (payload: { urls: string[] }) =>
      apiPost<ImportResult>('/api/my-backlinks/batch-import', payload),
    onSuccess: (result) => {
      const name = batchName.trim();
      setCompleted({ ...result, name });
      setBatchName('');
      setUrls('');
      queryClient.invalidateQueries({ queryKey: ['my-backlinks'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success(m['dash.my.batch_imported']({ count: result.added, name }));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canImport = batchName.trim().length > 0 && lines.length > 0;

  return (
    <>
      <PageHeader
        title={m['dash.my.title']()}
        description={m['dash.my.description']()}
      />

      <div className="mx-auto w-full max-w-3xl">
        <Card className="border-primary/20 shadow-[0_20px_60px_-35px_var(--color-primary)]">
          <CardHeader className="bg-muted/20 border-b px-6 py-6">
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                <Link2 className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{m['dash.my.batch_title']()}</CardTitle>
                <CardDescription>
                  {m['dash.my.batch_description']()}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-6 py-6">
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canImport || importBatch.isPending) return;
                importBatch.mutate({ urls: lines });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="backlink-batch-name">
                  {m['dash.my.batch_name']()}
                </Label>
                <Input
                  id="backlink-batch-name"
                  value={batchName}
                  maxLength={100}
                  onChange={(event) => setBatchName(event.target.value)}
                  placeholder={m['dash.my.batch_name_placeholder']()}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="backlink-batch-urls">
                    {m['dash.my.batch_urls']()}
                  </Label>
                  <span className="text-muted-foreground text-xs">
                    {m['dash.my.batch_url_count']({ count: lines.length })}
                  </span>
                </div>
                <Textarea
                  id="backlink-batch-urls"
                  value={urls}
                  onChange={(event) => setUrls(event.target.value)}
                  placeholder={m['dash.my.batch_urls_placeholder']()}
                  className="min-h-72 resize-y font-mono text-sm"
                  spellCheck={false}
                />
                <p className="text-muted-foreground text-sm">
                  {m['dash.my.batch_urls_hint']()}
                </p>
              </div>

              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-sm">
                  {canImport
                    ? m['dash.my.batch_ready']({ count: lines.length })
                    : m['dash.my.batch_required']()}
                </p>
                <Button
                  type="submit"
                  disabled={!canImport || importBatch.isPending}
                >
                  <Upload className="size-4" />
                  {importBatch.isPending
                    ? m['dash.my.batch_importing']()
                    : m['dash.my.batch_import']()}
                </Button>
              </div>
            </form>

            {completed && (
              <div className="bg-primary/5 border-primary/20 mt-6 flex gap-3 rounded-xl border p-4">
                <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{completed.name}</p>
                  <p className="text-muted-foreground">
                    {m['dash.my.batch_result']({
                      added: completed.added,
                      skipped: completed.skipped ?? 0,
                      invalid: completed.invalid ?? 0,
                    })}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export const Route = createFileRoute('/dashboard/my-backlinks')({
  component: MyBacklinksPage,
});
