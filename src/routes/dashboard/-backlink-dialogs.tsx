import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';

import {
  BACKLINK_CATEGORIES,
  BACKLINK_STATUSES,
  CONFIDENCES,
  COST_TYPES,
  LINK_TYPES,
  QUALITIES,
} from '@/config/backlinks';
import { apiPost, apiPut } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import {
  categoryLabel,
  costLabel,
  ExternalLink,
  formatTime,
  qualityLabel,
  StatusPill,
  TagList,
  useWebsiteOptions,
  type Backlink,
  type MyBacklink,
} from './-shared';

type Form = {
  name: string;
  link: string;
  category: string;
  language: string;
  costType: string;
  linkType: string;
  tags: string;
  dr: string;
  organicTraffic: string;
  details: string;
  tips: string;
  status: string;
  quality: string;
  confidence: string;
  personalQuality: string;
  notes: string;
  enabled: boolean;
};

function toForm(b?: Partial<MyBacklink>): Form {
  return {
    name: b?.name ?? '',
    link: b?.link ?? '',
    category: b?.category ?? 'directory',
    language: b?.language ?? '',
    costType: b?.costType ?? 'unknown',
    linkType: b?.linkType ?? 'unknown',
    tags: (b?.tags ?? []).join(', '),
    dr: b?.dr == null ? '' : String(b.dr),
    organicTraffic: b?.organicTraffic == null ? '' : String(b.organicTraffic),
    details: b?.details ?? '',
    tips: b?.tips ?? '',
    status: b?.status ?? 'approved',
    quality: b?.quality ?? 'unrated',
    confidence: b?.confidence ?? 'unknown',
    personalQuality: b?.personalQuality ?? 'unrated',
    notes: b?.notes ?? '',
    enabled: b?.enabled ?? true,
  };
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `space-y-2 ${className}` : 'space-y-2'}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Pick({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(String(v))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
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
  );
}

const catOptions = () =>
  BACKLINK_CATEGORIES.map((c) => ({
    value: c,
    label: `${categoryLabel[c]()} (${c})`,
  }));
const costOptions = () =>
  COST_TYPES.map((c) => ({ value: c, label: costLabel[c]() }));
const qualityOptions = () =>
  QUALITIES.map((q) => ({ value: q, label: qualityLabel[q]() }));
const raw = (list: readonly string[]) =>
  list.map((v) => ({ value: v, label: v }));

/** 新增外链 / 编辑外链 in my library. */
export function MyBacklinkDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: MyBacklink | null;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState<Form>(toForm());
  useEffect(() => {
    if (open) setF(toForm(editing ?? undefined));
  }, [open, editing]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const readOnlyBase = !!editing && !editing.isOwner;

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiPut(`/api/my-backlinks/${editing.id}`, f)
        : apiPost('/api/my-backlinks', f),
    onSuccess: () => {
      toast.success(m['dash.common.saved']());
      queryClient.invalidateQueries({ queryKey: ['my-backlinks'] });
      queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? m['dash.my.edit_title']() : m['dash.my.add_title']()}
          </DialogTitle>
          <DialogDescription>
            {editing ? m['dash.my.edit_desc']() : m['dash.my.add_desc']()}
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/40 flex gap-2 rounded-lg border px-3 py-2.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" />
          {readOnlyBase
            ? m['dash.my.public_note']()
            : m['dash.my.private_note']()}
        </div>
        <div className="space-y-4">
          <div className="text-sm font-medium">{m['dash.my.base_info']()}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m['dash.my.name']()}>
              <Input
                value={f.name}
                disabled={readOnlyBase}
                onChange={(e) => set('name', e.target.value)}
                placeholder={m['dash.my.name_placeholder']()}
              />
            </Field>
            <Field label={m['dash.my.link']()}>
              <Input
                value={f.link}
                disabled={readOnlyBase}
                onChange={(e) => set('link', e.target.value)}
                placeholder="https://example.com/submit"
              />
            </Field>
            <Field label={m['dash.common.category']()}>
              <Pick
                value={f.category}
                onChange={(v) => set('category', v)}
                options={catOptions()}
                disabled={readOnlyBase}
              />
            </Field>
            <Field label={m['dash.my.language']()}>
              <Input
                value={f.language}
                disabled={readOnlyBase}
                onChange={(e) => set('language', e.target.value)}
                placeholder={m['dash.my.language_placeholder']()}
              />
            </Field>
            <Field label={m['dash.my.cost']()}>
              <Pick
                value={f.costType}
                onChange={(v) => set('costType', v)}
                options={costOptions()}
                disabled={readOnlyBase}
              />
            </Field>
            <Field label={m['dash.my.link_type']()}>
              <Pick
                value={f.linkType}
                onChange={(v) => set('linkType', v)}
                options={raw(LINK_TYPES)}
                disabled={readOnlyBase}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 pt-2 text-sm font-medium">
            {m['dash.my.my_settings']()}
            <div className="bg-border h-px flex-1" />
          </div>
          <Field label={m['dash.my.quality']()}>
            <div className="w-[180px]">
              <Pick
                value={f.personalQuality}
                onChange={(v) => set('personalQuality', v)}
                options={qualityOptions()}
              />
            </div>
          </Field>
          <Field label={m['dash.my.notes']()}>
            <Textarea
              rows={3}
              value={f.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={m['dash.my.notes_placeholder']()}
            />
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">{m['dash.my.enable']()}</div>
              <div className="text-muted-foreground text-xs">
                {m['dash.my.enable_hint']()}
              </div>
            </div>
            <Switch
              checked={f.enabled}
              onCheckedChange={(v) => set('enabled', v)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['dash.common.cancel']()}
          </Button>
          <Button
            disabled={save.isPending || !f.link.trim()}
            onClick={() => save.mutate()}
          >
            {editing ? m['dash.common.save']() : m['dash.common.create']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Admin form for public plaza entries. */
export function PlazaBacklinkDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Backlink | null;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState<Form>(toForm());
  useEffect(() => {
    if (open) setF(toForm(editing ?? undefined));
  }, [open, editing]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiPut(`/api/backlinks/${editing.id}`, f)
        : apiPost('/api/backlinks', f),
    onSuccess: () => {
      toast.success(m['dash.common.saved']());
      queryClient.invalidateQueries({ queryKey: ['plaza'] });
      queryClient.invalidateQueries({ queryKey: ['backlink-facets'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? m['dash.plaza.edit_title']()
              : m['dash.plaza.add_title']()}
          </DialogTitle>
          <DialogDescription>{m['dash.plaza.form_desc']()}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={m['dash.my.name']()}>
            <Input
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={m['dash.my.link']()}>
            <Input
              value={f.link}
              onChange={(e) => set('link', e.target.value)}
              placeholder="https://example.com/submit"
            />
          </Field>
          <Field label={m['dash.common.category']()}>
            <Pick
              value={f.category}
              onChange={(v) => set('category', v)}
              options={catOptions()}
            />
          </Field>
          <Field label={m['dash.common.tags']()}>
            <Input
              value={f.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="startup, directory"
            />
          </Field>
          <Field label={m['dash.my.cost']()}>
            <Pick
              value={f.costType}
              onChange={(v) => set('costType', v)}
              options={costOptions()}
            />
          </Field>
          <Field label={m['dash.my.link_type']()}>
            <Pick
              value={f.linkType}
              onChange={(v) => set('linkType', v)}
              options={raw(LINK_TYPES)}
            />
          </Field>
          <Field label="DR">
            <Input
              type="number"
              value={f.dr}
              onChange={(e) => set('dr', e.target.value)}
            />
          </Field>
          <Field label={m['dash.plaza.traffic']()}>
            <Input
              type="number"
              value={f.organicTraffic}
              onChange={(e) => set('organicTraffic', e.target.value)}
            />
          </Field>
          <Field label={m['dash.my.language']()}>
            <Input
              value={f.language}
              onChange={(e) => set('language', e.target.value)}
              placeholder="en"
            />
          </Field>
          <Field label={m['dash.common.status']()}>
            <Pick
              value={f.status}
              onChange={(v) => set('status', v)}
              options={raw(BACKLINK_STATUSES)}
            />
          </Field>
          <Field label={m['dash.plaza.quality']()}>
            <Pick
              value={f.quality}
              onChange={(v) => set('quality', v)}
              options={qualityOptions()}
            />
          </Field>
          <Field label={m['dash.plaza.confidence']()}>
            <Pick
              value={f.confidence}
              onChange={(v) => set('confidence', v)}
              options={raw(CONFIDENCES)}
            />
          </Field>
          <Field label={m['dash.plaza.details']()} className="sm:col-span-2">
            <Textarea
              rows={3}
              value={f.details}
              onChange={(e) => set('details', e.target.value)}
            />
          </Field>
          <Field label={m['dash.plaza.tips']()} className="sm:col-span-2">
            <Textarea
              rows={3}
              value={f.tips}
              onChange={(e) => set('tips', e.target.value)}
              placeholder={m['dash.plaza.tips_placeholder']()}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['dash.common.cancel']()}
          </Button>
          <Button
            disabled={save.isPending || !f.link.trim()}
            onClick={() => save.mutate()}
          >
            {m['dash.common.save']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm break-words">{children || '-'}</div>
    </div>
  );
}

/** 查看: everything stored about an entry. */
export function BacklinkDetailDialog({
  backlink: b,
  onOpenChange,
}: {
  backlink: Backlink | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={!!b} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{b?.name}</DialogTitle>
          <DialogDescription>
            {b && <ExternalLink href={b.link} />}
          </DialogDescription>
        </DialogHeader>
        {b && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label={m['dash.common.category']()}>
              {categoryLabel[b.category]?.() ?? b.category}
            </Row>
            <Row label={m['dash.common.tags']()}>
              {b.tags.length ? <TagList tags={b.tags} max={20} /> : null}
            </Row>
            <Row label={m['dash.common.status']()}>
              <StatusPill status={b.status} />
            </Row>
            <Row label={m['dash.my.cost']()}>{costLabel[b.costType]?.()}</Row>
            <Row label={m['dash.my.link_type']()}>{b.linkType}</Row>
            <Row label={m['dash.my.language']()}>{b.language}</Row>
            <Row label="DR">{b.dr ?? '-'}</Row>
            <Row label={m['dash.plaza.traffic']()}>
              {b.organicTraffic?.toLocaleString() ?? '-'}
            </Row>
            <Row label={m['dash.plaza.quality']()}>
              {qualityLabel[b.quality]?.()}
            </Row>
            <Row label={m['dash.plaza.confidence']()}>{b.confidence}</Row>
            <div className="sm:col-span-2">
              <Row label={m['dash.plaza.details']()}>{b.details}</Row>
            </div>
            <div className="sm:col-span-2">
              <Row label={m['dash.plaza.tips']()}>{b.tips}</Row>
            </div>
            <Row label={m['dash.common.created']()}>
              {formatTime(b.createdAt)}
            </Row>
            <Row label={m['dash.common.updated']()}>
              {formatTime(b.updatedAt)}
            </Row>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 添加到网站 for one entry. */
export function AddToWebsiteDialog({
  backlink,
  onOpenChange,
}: {
  backlink: { id: string; name: string } | null;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const sites = useWebsiteOptions();
  const [siteId, setSiteId] = useState('');
  const chosen = siteId || sites.data?.[0]?.id || '';
  const add = useMutation({
    mutationFn: () =>
      apiPost<{ added: number; skipped: number }>(
        `/api/websites/${chosen}/backlinks`,
        {
          ids: [backlink!.id],
        }
      ),
    onSuccess: (r) => {
      toast.success(
        r.added
          ? m['dash.plaza.added_to_website']()
          : m['dash.plaza.already_in_website']()
      );
      queryClient.invalidateQueries({ queryKey: ['websites'] });
      queryClient.invalidateQueries({ queryKey: ['website-records'] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!backlink} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m['dash.plaza.add_to_website']()}</DialogTitle>
          <DialogDescription>
            {m['dash.plaza.add_to_website_desc']({
              name: backlink?.name ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        {sites.data?.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m['dash.websites.empty']()}
          </p>
        ) : (
          <div className="space-y-2">
            <Label>{m['dash.codex.website']()}</Label>
            <Select
              value={chosen}
              onValueChange={(v) => setSiteId(String(v ?? ''))}
              items={(sites.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m['dash.common.cancel']()}
          </Button>
          <Button
            disabled={!chosen || add.isPending}
            onClick={() => add.mutate()}
          >
            {m['dash.plaza.add_to_website']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
