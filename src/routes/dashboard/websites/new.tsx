import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Bot, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { normalizeUrl } from '@/config/backlinks';
import { apiPost, apiPut } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { AddBacklinksPanel } from '../-add-backlinks';
import { CodexDialog } from '../-codex-dialog';
import { ProfileImportDialog } from '../-profile-import';
import { PageHeader, type Website } from '../-shared';
import {
  emptyWebsite,
  mergeMeta,
  WebsiteFields,
  type SiteMeta,
  type WebsiteForm,
} from '../-website-form';

const STEPS = [
  () => m['dash.wizard.step_domain'](),
  () => m['dash.wizard.step_profile'](),
  () => m['dash.wizard.step_backlinks'](),
  () => m['dash.wizard.step_codex'](),
];

function NewWebsitePage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState('');
  const [form, setForm] = useState<WebsiteForm>(emptyWebsite());
  const [siteId, setSiteId] = useState<string | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const toProfile = useMutation({
    mutationFn: async () => {
      const normalized = normalizeUrl(url);
      if (!normalized) throw new Error(m['dash.wizard.bad_url']());
      const base = { ...form, url: normalized };
      try {
        const meta = await apiPost<SiteMeta>('/api/websites/fetch-meta', {
          url: normalized,
        });
        return mergeMeta(base, meta);
      } catch {
        return base; // Unreachable site: the user fills it in by hand.
      }
    },
    onSuccess: (f) => {
      setForm(f);
      setStep(1);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      siteId
        ? apiPut<Website>(`/api/websites/${siteId}`, form)
        : apiPost<Website>('/api/websites', form),
    onSuccess: (w) => {
      setSiteId(w.id);
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      queryClient.invalidateQueries({ queryKey: ['website-options'] });
      setStep(2);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const next = () => {
    if (step === 0) toProfile.mutate();
    else if (step === 1) saveProfile.mutate();
    else if (step === 2) setStep(3);
  };
  const busy = toProfile.isPending || saveProfile.isPending;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={m['dash.wizard.title']()}
        description={m['dash.wizard.description']()}
        actions={
          <Link
            href="/dashboard/websites"
            className={buttonVariants({ variant: 'outline' })}
          >
            {m['dash.websites.back']()}
          </Link>
        }
      />
      <div className="bg-muted/40 grid grid-cols-4 gap-1 rounded-xl border p-1.5">
        {STEPS.map((label, i) => (
          <div
            key={i}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg py-2 text-xs',
              i === step
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border',
                i === step && 'border-primary-foreground'
              )}
            >
              {i + 1}
            </span>
            {label()}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <div className="font-semibold">
                {m['dash.wizard.domain_title']()}
              </div>
              <div className="text-muted-foreground text-sm">
                {m['dash.wizard.domain_desc']()}
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                URL <span className="text-destructive">*</span>
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && next()}
                placeholder="https://example.com"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImporting(true)}
            >
              <Wand2 className="size-4" />
              {m['dash.import.button']()}
            </Button>
          </div>
          <WebsiteFields value={form} onChange={setForm} only="core" />
          <ProfileImportDialog
            open={importing}
            onOpenChange={setImporting}
            form={form}
            onImport={setForm}
          />
        </div>
      )}

      {step === 2 && siteId && (
        <Card>
          <CardContent>
            <AddBacklinksPanel
              target={{
                kind: 'website',
                websiteId: siteId,
                websiteName: form.name,
              }}
              onDone={() => setStep(3)}
            />
          </CardContent>
        </Card>
      )}

      {step === 3 && siteId && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <div className="font-semibold">
                {m['dash.wizard.codex_title']()}
              </div>
              <div className="text-muted-foreground text-sm">
                {m['dash.wizard.codex_desc']()}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setCodexOpen(true)}>
                <Bot className="size-4" />
                {m['dash.wizard.open_codex']()}
              </Button>
              <Link
                href={`/dashboard/websites/${siteId}/edit`}
                className={buttonVariants({ variant: 'outline' })}
              >
                {m['dash.wizard.complete_profile']()}
              </Link>
              <Link
                href="/dashboard/websites"
                className={buttonVariants({ variant: 'outline' })}
              >
                {m['dash.wizard.done']()}
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          disabled={step === 0 || busy}
          onClick={() => setStep((s) => s - 1)}
        >
          <ArrowLeft className="size-4" />
          {m['dash.wizard.prev']()}
        </Button>
        {step < 3 && (
          <div className="flex gap-2">
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(3)}>
                {m['dash.wizard.skip']()}
              </Button>
            )}
            {step < 2 && (
              <Button
                disabled={busy || (step === 0 && !url.trim())}
                onClick={next}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {m['dash.wizard.next']()}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      {siteId && (
        <CodexDialog
          open={codexOpen}
          onOpenChange={setCodexOpen}
          websiteId={siteId}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/dashboard/websites/new')({
  component: NewWebsitePage,
});
