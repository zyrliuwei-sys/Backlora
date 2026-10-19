import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { apiGet, apiPut } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ProfileImportDialog } from '../../-profile-import';
import { PageHeader, type Website } from '../../-shared';
import {
  toWebsiteForm,
  WebsiteFields,
  type WebsiteForm,
} from '../../-website-form';

function EditWebsitePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const site = useQuery({
    queryKey: ['website', id],
    queryFn: () => apiGet<Website>(`/api/websites/${id}`),
  });
  const [form, setForm] = useState<WebsiteForm | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (site.data && !form) setForm(toWebsiteForm(site.data));
  }, [site.data, form]);

  const save = useMutation({
    mutationFn: () => apiPut(`/api/websites/${id}`, form),
    onSuccess: () => {
      toast.success(m['dash.common.saved']());
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      queryClient.invalidateQueries({ queryKey: ['website', id] });
      queryClient.invalidateQueries({ queryKey: ['website-options'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!form) {
    return site.isError ? (
      <p className="text-muted-foreground">{m['dash.websites.not_found']()}</p>
    ) : (
      <Skeleton className="h-96 w-full" />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={m['dash.websites.edit_title']()}
        description={m['dash.websites.edit_desc']()}
        actions={
          <>
            <Link
              href="/dashboard/websites"
              className={buttonVariants({ variant: 'outline' })}
            >
              {m['dash.websites.back']()}
            </Link>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Wand2 className="size-4" />
              {m['dash.import.button']()}
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {m['dash.common.save']()}
            </Button>
          </>
        }
      />
      <WebsiteFields value={form} onChange={setForm} />
      <ProfileImportDialog
        open={importing}
        onOpenChange={setImporting}
        form={form}
        onImport={setForm}
      />
      <div className="flex justify-end">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {m['dash.common.save']()}
        </Button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/dashboard/websites/$id/edit')({
  component: EditWebsitePage,
});
