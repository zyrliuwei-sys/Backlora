import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import {
  AUTOMATION_CONTAINERS,
  BACKLINK_CATEGORIES,
  DATA_SOURCES,
  TASK_SCOPES,
  type AutomationContainer,
  type DataSource,
  type TaskScope,
} from '@/config/backlinks';
import { apiGet, type PageResult } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea';

import {
  buildApiDoc,
  buildPrimaryPrompt,
  DEFAULT_CUSTOM_PROMPT,
  OLD_CUSTOM_PROMPTS,
} from './-agent-prompt';
import {
  categoryLabel,
  useWebsiteOptions,
  type Readiness,
  type Website,
} from './-shared';

interface ApiKeyRow {
  id: string;
  title: string;
  keyPrefix: string;
  key: string | null;
  status?: string;
}

const AUTO = '__auto__';

const sourceLabel: Record<DataSource, () => string> = {
  website: m['dash.codex.source_website'],
  plaza: m['dash.codex.source_plaza'],
  personal: m['dash.codex.source_personal'],
};
const scopeLabel: Record<TaskScope, () => string> = {
  recommended: m['dash.codex.scope_recommended'],
  all_eligible: m['dash.codex.scope_all'],
};

function OptionSelect<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        items={options}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * 使用 Codex 提交外链: builds the prompt (options → primary prompt), keeps
 * the user's custom rules per website in localStorage, and copies
 * primary + custom + API doc.
 */
export function CodexDialog({
  open,
  onOpenChange,
  websiteId: initialWebsiteId,
  defaultSource = 'website',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  websiteId?: string | null;
  defaultSource?: DataSource;
}) {
  const [keyId, setKeyId] = useState('');
  const [siteId, setSiteId] = useState<string>(initialWebsiteId ?? AUTO);
  const [dataSource, setDataSource] = useState<DataSource>(defaultSource);
  const [category, setCategory] = useState('all');
  const [num, setNum] = useState(10);
  const [scope, setScope] = useState<TaskScope>('all_eligible');
  const [container, setContainer] =
    useState<AutomationContainer>('ego-browser');
  const [primary, setPrimary] = useState('');
  const [primaryEdited, setPrimaryEdited] = useState(false);
  const [custom, setCustom] = useState(DEFAULT_CUSTOM_PROMPT);

  const storageKey = `backlora:codex:custom-prompt:${siteId}`;

  useEffect(() => {
    if (!open) return;
    setSiteId(initialWebsiteId ?? AUTO);
    setDataSource(defaultSource);
    setCategory('all');
    setNum(10);
    setScope('all_eligible');
    setContainer('ego-browser');
    setPrimaryEdited(false);
  }, [open, initialWebsiteId, defaultSource]);

  useEffect(() => {
    if (!open) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      setCustom(
        saved == null || OLD_CUSTOM_PROMPTS.includes(saved)
          ? DEFAULT_CUSTOM_PROMPT
          : saved
      );
    } catch {
      setCustom(DEFAULT_CUSTOM_PROMPT);
    }
  }, [open, storageKey]);

  const keys = useQuery({
    queryKey: ['apikeys', 'all'],
    queryFn: () =>
      apiGet<PageResult<ApiKeyRow>>('/api/apikeys?page=1&pageSize=100'),
    enabled: open,
  });
  const usable = (keys.data?.items ?? []).filter(
    (k) => k.key && k.status !== 'disabled'
  );
  useEffect(() => {
    if (open && !usable.some((k) => k.id === keyId) && usable[0])
      setKeyId(usable[0].id);
  }, [open, usable, keyId]);
  const apiKey = usable.find((k) => k.id === keyId)?.key ?? '';

  const sites = useWebsiteOptions();
  const site = useQuery({
    queryKey: ['website', siteId],
    queryFn: () =>
      apiGet<Website & { submission_readiness: Readiness }>(
        `/api/websites/${siteId}`
      ),
    enabled: open && siteId !== AUTO,
  });
  const readiness = site.data?.submission_readiness;

  const baseUrl = typeof window === 'undefined' ? '' : window.location.origin;
  const generated = useMemo(
    () =>
      buildPrimaryPrompt({
        baseUrl,
        apiKey: apiKey || '<API_KEY>',
        websiteId: siteId === AUTO ? null : siteId,
        dataSource,
        category,
        num,
        taskScope: scope,
        container,
        backlinkManagementUrl: site.data?.backlinkManagementUrl,
        emailManagementUrl: site.data?.emailManagementUrl,
      }),
    [
      baseUrl,
      apiKey,
      siteId,
      dataSource,
      category,
      num,
      scope,
      container,
      site.data,
    ]
  );
  // Options rewrite the prompt unless the user has edited it by hand.
  useEffect(() => {
    if (!primaryEdited) setPrimary(generated);
  }, [generated, primaryEdited]);

  function saveCustom(v: string) {
    setCustom(v);
    try {
      window.localStorage.setItem(storageKey, v);
    } catch {
      // Private mode etc.: the text just isn't remembered.
    }
  }

  const blocked = !!readiness && readiness.blocking_fields.length > 0;

  async function copy() {
    const text = [primary.trim(), custom.trim(), buildApiDoc(baseUrl)]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(m['dash.codex.copied']());
    } catch {
      toast.error(m['dash.codex.copy_failed']());
    }
  }

  const siteName =
    siteId === AUTO
      ? m['dash.codex.auto_website']()
      : (sites.data?.find((s) => s.id === siteId)?.name ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m['dash.codex.title']()}</DialogTitle>
          <DialogDescription>
            {m['dash.codex.description']({ name: siteName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 rounded-xl border p-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_110px] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="codex-api-key">API Key</Label>
              {usable.length ? (
                <Select
                  value={keyId}
                  onValueChange={(v) => setKeyId((v as string) ?? '')}
                  items={usable.map((k) => ({
                    value: k.id,
                    label: `${k.title} (${k.keyPrefix}…)`,
                  }))}
                >
                  <SelectTrigger id="codex-api-key" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.title} ({k.keyPrefix}…)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {keys.isPending
                    ? m['dash.common.loading']()
                    : m['dash.codex.no_key']()}
                </p>
              )}
            </div>
            <Link
              href="/dashboard/apikeys"
              className="text-primary text-sm hover:underline sm:pb-2"
            >
              {m['dash.codex.add_key']()}
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OptionSelect
              id="codex-site"
              label={m['dash.codex.website']()}
              value={siteId}
              onChange={setSiteId}
              options={[
                { value: AUTO, label: m['dash.codex.auto_website']() },
                ...(sites.data ?? []).map((s) => ({
                  value: s.id,
                  label: s.name,
                })),
              ]}
            />
            <OptionSelect
              id="codex-source"
              label={m['dash.codex.data_source']()}
              value={dataSource}
              onChange={setDataSource}
              options={DATA_SOURCES.map((s) => ({
                value: s,
                label: sourceLabel[s](),
              }))}
            />
            <OptionSelect
              id="codex-category"
              label={m['dash.common.category']()}
              value={category}
              onChange={setCategory}
              options={[
                { value: 'all', label: m['dash.common.all_categories']() },
                ...BACKLINK_CATEGORIES.map((c) => ({
                  value: c,
                  label: categoryLabel[c](),
                })),
              ]}
            />
            <div className="space-y-2">
              <Label htmlFor="codex-num">{m['dash.codex.num']()}</Label>
              <Input
                id="codex-num"
                type="number"
                min={1}
                max={200}
                value={num}
                onChange={(e) =>
                  setNum(
                    Math.max(1, Math.min(200, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
            <OptionSelect
              id="codex-scope"
              label={m['dash.codex.scope']()}
              value={scope}
              onChange={setScope}
              options={TASK_SCOPES.map((s) => ({
                value: s,
                label: scopeLabel[s](),
              }))}
            />
            <OptionSelect
              id="codex-container"
              label={m['dash.codex.container']()}
              value={container}
              onChange={setContainer}
              options={AUTOMATION_CONTAINERS.map((c) => ({
                value: c,
                label: c,
              }))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={copy} disabled={!apiKey || blocked}>
              {m['dash.codex.copy']()}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {m['dash.common.close']()}
            </Button>
          </div>
          {scope === 'all_eligible' && (
            <p className="text-muted-foreground text-xs">
              {m['dash.codex.paid_note']()}
            </p>
          )}
        </div>

        {siteId !== AUTO && (
          <div className="space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{m['dash.codex.readiness']()}</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => site.refetch()}
              >
                {m['dash.codex.recheck']()}
              </Button>
            </div>
            {readiness && (
              <div className="text-sm">
                {m['dash.codex.readiness_status']()}
                {readiness.blocking_fields.length ? (
                  <span className="text-destructive">
                    {m['dash.codex.readiness_blocking']({
                      fields: readiness.blocking_fields.join(', '),
                    })}
                  </span>
                ) : readiness.missing_fields.length ||
                  readiness.invalid_fields.length ? (
                  <span>
                    {m['dash.codex.readiness_partial']({
                      fields: [
                        ...readiness.missing_fields,
                        ...readiness.invalid_fields,
                      ].join(', '),
                    })}
                  </span>
                ) : (
                  <span>{m['dash.codex.readiness_ok']()}</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="codex-primary-prompt">
              {m['dash.codex.primary']()}
            </Label>
            {primaryEdited && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPrimaryEdited(false)}
              >
                {m['dash.codex.regenerate']()}
              </Button>
            )}
          </div>
          <Textarea
            id="codex-primary-prompt"
            value={primary}
            onChange={(e) => {
              setPrimary(e.target.value);
              setPrimaryEdited(true);
            }}
            className="h-[150px] min-h-0 resize-y font-mono text-xs leading-relaxed"
          />
          <p className="text-muted-foreground text-xs">
            {m['dash.codex.primary_hint']()}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="codex-custom-prompt">
            {m['dash.codex.custom']()}
          </Label>
          <Textarea
            id="codex-custom-prompt"
            value={custom}
            onChange={(e) => saveCustom(e.target.value)}
            className="h-[90px] min-h-0 resize-y font-mono text-xs leading-relaxed"
          />
          <p className="text-muted-foreground text-xs">
            {m['dash.codex.custom_hint']()}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
