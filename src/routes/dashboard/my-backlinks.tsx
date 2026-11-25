import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, Info, Link2 } from 'lucide-react';
import { toast } from 'sonner';

import { apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { BatchImportForm, type BatchImportInput } from './-batch-import-form';
import { LibraryBatches } from './-library-batches';
import { PageHeader } from './-shared';
import { SuccessfulBacklinks } from './-successful-backlinks';

type ImportResult = {
  added: number;
  skipped?: number;
  invalid?: number;
};

type CompletedBatch = ImportResult & {
  name: string;
};

function MyBacklinksPage() {
  const queryClient = useQueryClient();
  const [completed, setCompleted] = useState<CompletedBatch | null>(null);

  const importBatch = useMutation({
    mutationFn: (payload: BatchImportInput) =>
      apiPost<ImportResult>('/api/my-backlinks/batch-import', payload),
    onSuccess: (result, { batchName: name }) => {
      setCompleted({ ...result, name });
      if (result.added > 0) {
        toast.success(
          m['dash.my.batch_imported']({ count: result.added, name })
        );
      } else {
        toast.info(m['dash.my.batch_none_added']());
      }
      queryClient.invalidateQueries({ queryKey: ['my-backlinks'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });

  return (
    <>
      <PageHeader
        title={m['dash.my.title']()}
        description={m['dash.my.description']()}
      />

      <Tabs
        defaultValue="library"
        className="mx-auto w-full max-w-3xl min-w-0 gap-4 xl:max-w-6xl"
      >
        <TabsList>
          <TabsTrigger value="library">
            {m['dash.my.library_tab']()}
          </TabsTrigger>
          <TabsTrigger value="successful">
            {m['dash.my.success_tab']()}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library" keepMounted>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
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
                <BatchImportForm
                  onImport={async (input) =>
                    (await importBatch.mutateAsync(input)).added > 0
                  }
                />

                {completed && (
                  <div className="bg-primary/5 border-primary/20 mt-6 flex gap-3 rounded-xl border p-4">
                    {completed.added > 0 ? (
                      <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
                    ) : (
                      <Info className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                    )}
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
            <LibraryBatches />
          </div>
        </TabsContent>
        <TabsContent value="successful" className="min-w-0">
          <SuccessfulBacklinks />
        </TabsContent>
      </Tabs>
    </>
  );
}

export const Route = createFileRoute('/dashboard/my-backlinks')({
  component: MyBacklinksPage,
});
