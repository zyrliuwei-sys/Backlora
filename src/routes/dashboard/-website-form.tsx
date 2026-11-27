import { useId, useRef, useState, type ReactNode } from 'react';
import {
  ImageIcon,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { COMPANY_FOUNDED_YEAR_KEY, PRICE_MODELS } from '@/config/backlinks';
import { apiUpload } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

import type { Website } from './-shared';

export type WebsiteForm = Omit<
  Website,
  | 'id'
  | 'counts'
  | 'createdAt'
  | 'updatedAt'
  | 'hasRegistrationPassword'
  | 'registrationEmail'
  | 'registrationEmailCapability'
  | 'verificationInboxEmail'
  | 'emailManagementUrl'
>;

export function emptyWebsite(url = ''): WebsiteForm {
  return {
    status: 'enabled',
    name: '',
    url,
    internalNote: '',
    email: '',
    emailCapability: 'unknown',
    googleLoginEmail: null,
    launchDate: '',
    iconUrl: '',
    screenshotUrls: [],
    shortDesc: '',
    longDesc: '',
    tagline: '',
    slogan: '',
    categories: [],
    tags: [],
    priceModel: '',
    lowestPrice: '',
    links: [],
    backlinkManagementUrl: '',
    autoBacklinkEnabled: true,
    agentSubmissionNote: '',
    ownerAvatarUrl: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
    ownerTwitter: '',
    socialLinks: {},
    location: {},
    metadata: [],
  };
}

export function toWebsiteForm(w: Website): WebsiteForm {
  const {
    id: _id,
    counts: _counts,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    hasRegistrationPassword: _hasRegistrationPassword,
    registrationEmail: _registrationEmail,
    registrationEmailCapability: _registrationEmailCapability,
    verificationInboxEmail: _verificationInboxEmail,
    emailManagementUrl: _emailManagementUrl,
    ...rest
  } = w;
  return { ...emptyWebsite(), ...rest };
}

const FIRST = [
  'Henry',
  'Olivia',
  'James',
  'Emma',
  'Lucas',
  'Mia',
  'Ethan',
  'Ava',
  'Noah',
  'Chloe',
];
const LAST = [
  'Walker',
  'Carter',
  'Hayes',
  'Bennett',
  'Brooks',
  'Reed',
  'Foster',
  'Ward',
  'Hughes',
  'Price',
];
const ADDRESSES = [
  {
    state: 'OR',
    city: 'Portland',
    zip: '97205',
    address: '995 Rosewood Trail',
  },
  { state: 'TX', city: 'Austin', zip: '78701', address: '412 Congress Ave' },
  { state: 'WA', city: 'Seattle', zip: '98101', address: '1520 Pine St' },
  { state: 'CO', city: 'Denver', zip: '80202', address: '1700 Market St' },
  {
    state: 'NC',
    city: 'Raleigh',
    zip: '27601',
    address: '230 Fayetteville St',
  },
];
const pickOne = <T,>(list: T[]) =>
  list[Math.floor(Math.random() * list.length)];

function Section({
  title,
  desc,
  extra,
  children,
}: {
  title: string;
  desc?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {desc && <p className="text-muted-foreground text-sm">{desc}</p>}
          </div>
          {extra}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function F({
  label,
  htmlFor,
  required,
  hint,
  children,
  wide,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', wide && 'sm:col-span-2')}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      {children}
    </div>
  );
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

function MediaLinkEditor({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const edit = m['dash.form.media_edit_link']();
  const apply = (url: string) => {
    onChange(url.trim());
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" />}
        disabled={disabled}
        aria-label={m['dash.form.media_action']({ action: edit, asset: label })}
      >
        <Link2 />
        {edit}
      </DialogTrigger>
      <DialogContent initialFocus={field}>
        <DialogHeader>
          <DialogTitle>
            {m['dash.form.media_link_title']({ asset: label })}
          </DialogTitle>
        </DialogHeader>
        <Input
          ref={field}
          aria-label={m['dash.form.media_link_title']({ asset: label })}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            apply(draft);
          }}
        />
        <DialogFooter>
          {value && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={() => apply('')}
            >
              {m['dash.form.media_remove']()}
            </Button>
          )}
          <DialogClose render={<Button type="button" variant="outline" />}>
            {m['dash.common.cancel']()}
          </DialogClose>
          <Button type="button" onClick={() => apply(draft)}>
            {m['dash.form.media_apply']()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Image field: paste a URL or upload a file. Uploads go to R2 when storage is
 * configured, else to public/uploads (see /api/storage/upload-image).
 */
function ImageUrl({
  value,
  onChange,
  asset,
}: {
  value: string;
  onChange: (v: string) => void;
  asset?: { kind: 'icon' | 'screenshot'; label: string };
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('files', file);
      const { urls } = await apiUpload<{ urls: string[] }>(
        '/api/storage/upload-image',
        form
      );
      // The local fallback returns a path; agents need an absolute URL.
      const url = new URL(urls[0], window.location.origin).toString();
      // A file just written to public/ can 404 for a moment in dev; wait for it
      // so the preview doesn't stay broken.
      for (let i = 0; i < 5 && url.startsWith(window.location.origin); i++) {
        if ((await fetch(url, { method: 'HEAD' }).catch(() => null))?.ok) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      onChange(url);
      toast.success(m['dash.form.upload_done']());
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : m['dash.form.upload_failed']()
      );
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={IMAGE_TYPES}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) upload(file);
      }}
    />
  );
  const uploadIcon = uploading ? (
    <Loader2 className="animate-spin" />
  ) : (
    <Upload />
  );

  if (asset) {
    const isIcon = asset.kind === 'icon';
    const uploadLabel = value
      ? m['dash.form.media_replace']()
      : m['dash.form.upload']();
    return (
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-lg border',
          isIcon && 'flex items-center gap-2 p-2.5'
        )}
      >
        {fileInput}
        <div
          className={cn(
            'bg-muted/40 relative grid shrink-0 place-items-center overflow-hidden',
            isIcon ? 'size-10 rounded-md border' : 'aspect-video border-b'
          )}
        >
          {value ? (
            <img
              src={value}
              alt=""
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <ImageIcon
              aria-hidden="true"
              className="text-muted-foreground size-5"
            />
          )}
        </div>
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1',
            !isIcon && 'px-3 py-2'
          )}
        >
          <span className="text-sm font-medium">{asset.label}</span>
          <div className="flex items-center gap-1">
            <MediaLinkEditor
              label={asset.label}
              value={value}
              onChange={onChange}
              disabled={uploading}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              aria-label={m['dash.form.media_action']({
                action: uploadLabel,
                asset: asset.label,
              })}
              onClick={() => input.current?.click()}
            >
              {uploadIcon}
              {uploadLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-muted size-16 overflow-hidden rounded-lg border">
        {value && <img src={value} alt="" className="size-16 object-cover" />}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          disabled={uploading}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
        {fileInput}
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={uploading}
          aria-label={m['dash.form.upload']()}
          onClick={() => input.current?.click()}
        >
          {uploadIcon}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m['dash.common.clear']()}
            onClick={() => onChange('')}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Chips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={m['dash.form.enter_to_add']()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const v = draft.trim();
            if (v && !value.includes(v)) onChange([...value, v]);
            setDraft('');
          }
        }}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v} className="gap-1">
              {v}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const SOCIAL: [string, string][] = [
  ['facebook', 'Facebook'],
  ['twitter', 'Twitter'],
  ['linkedin', 'LinkedIn'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['github', 'GitHub'],
];

/** All the profile sections; `only` limits it to the core fields (wizard). */
export function WebsiteFields({
  value: v,
  onChange,
  only,
}: {
  value: WebsiteForm;
  onChange: (v: WebsiteForm) => void;
  only?: 'core';
}) {
  const fieldId = useId();
  const set = <K extends keyof WebsiteForm>(k: K, val: WebsiteForm[K]) =>
    onChange({ ...v, [k]: val });
  const shot = (i: number, url: string) => {
    const list = [...v.screenshotUrls];
    list[i] = url;
    set(
      'screenshotUrls',
      list.filter((s, idx) => s || idx < i)
    );
  };
  const randomUser = () => {
    const first = pickOne(FIRST);
    const last = pickOne(LAST);
    onChange({
      ...v,
      ownerFirstName: first,
      ownerLastName: last,
      ownerEmail: `${first}.${last}@example.com`.toLowerCase(),
      // Colored cartoon on a pastel background; PNG because many target
      // sites refuse SVG uploads.
      ownerAvatarUrl: `https://api.dicebear.com/9.x/adventurer/png?seed=${first}${last}&size=256&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`,
    });
  };
  const randomAddress = () => {
    const a = pickOne(ADDRESSES);
    set('location', { country: 'United States', ...a });
  };

  return (
    <div className="space-y-4">
      <Section title={m['dash.form.product']()}>
        <div className="@container space-y-5">
          <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.85fr)]">
            <F
              label={m['dash.common.name']()}
              htmlFor={`${fieldId}-name`}
              required
            >
              <Input
                id={`${fieldId}-name`}
                value={v.name}
                onChange={(e) => set('name', e.target.value)}
                aria-required="true"
              />
            </F>
            <F label="URL" htmlFor={`${fieldId}-url`} required>
              <Input
                id={`${fieldId}-url`}
                value={v.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://example.com"
                aria-required="true"
              />
            </F>
            <F label={m['dash.form.launch_date']()} htmlFor={`${fieldId}-date`}>
              <Input
                id={`${fieldId}-date`}
                type="date"
                value={v.launchDate}
                onChange={(e) => set('launchDate', e.target.value)}
              />
            </F>
          </div>
          <div className="grid gap-4 border-t pt-5 @lg:grid-cols-2">
            <F label={m['dash.form.email']()} htmlFor={`${fieldId}-contact`}>
              <Input
                id={`${fieldId}-contact`}
                type="email"
                value={v.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="support@example.com"
                aria-describedby={`${fieldId}-contact-hint`}
              />
              <p
                id={`${fieldId}-contact-hint`}
                className="text-muted-foreground text-xs leading-relaxed"
              >
                {m['dash.form.email_hint']()}
              </p>
            </F>
            <F
              label={m['dash.form.google_login_email']()}
              htmlFor={`${fieldId}-google`}
              required
            >
              <Input
                id={`${fieldId}-google`}
                type="email"
                autoComplete="off"
                aria-required="true"
                value={v.googleLoginEmail ?? ''}
                onChange={(e) => set('googleLoginEmail', e.target.value)}
                placeholder="name@gmail.com"
                aria-describedby={`${fieldId}-google-hint`}
              />
              <p
                id={`${fieldId}-google-hint`}
                className="text-muted-foreground text-xs leading-relaxed"
              >
                {m['dash.form.google_login_email_hint']()}
              </p>
            </F>
          </div>
          <div className="space-y-3 border-t pt-5">
            <h3 className="text-sm font-semibold">
              {m['dash.form.product_media']()}
            </h3>
            <ImageUrl
              asset={{ kind: 'icon', label: m['dash.form.icon']() }}
              value={v.iconUrl}
              onChange={(x) => set('iconUrl', x)}
            />
            <div className="grid gap-3 @lg:grid-cols-2">
              {[0, 1].map((index) => (
                <ImageUrl
                  key={index}
                  asset={{
                    kind: 'screenshot',
                    label: m['dash.form.screenshot']({ n: index + 1 }),
                  }}
                  value={v.screenshotUrls[index] ?? ''}
                  onChange={(x) => shot(index, x)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
          <F label={m['dash.form.short_desc']()} required wide>
            <Textarea
              rows={3}
              value={v.shortDesc}
              onChange={(e) => set('shortDesc', e.target.value)}
            />
          </F>
          <F label={m['dash.form.long_desc']()} wide>
            <Textarea
              rows={8}
              value={v.longDesc}
              onChange={(e) => set('longDesc', e.target.value)}
            />
          </F>
          <F label={m['dash.form.tagline']()}>
            <Input
              value={v.tagline}
              onChange={(e) => set('tagline', e.target.value)}
            />
          </F>
          <F label={m['dash.form.slogan']()}>
            <Input
              value={v.slogan}
              onChange={(e) => set('slogan', e.target.value)}
            />
          </F>
          <F label={m['dash.common.category']()} wide>
            <Chips
              value={v.categories}
              onChange={(x) => set('categories', x)}
            />
          </F>
          <F label={m['dash.common.tags']()} wide>
            <Chips value={v.tags} onChange={(x) => set('tags', x)} />
          </F>
          <F label={m['dash.form.price_model']()}>
            <Select
              value={v.priceModel || 'none'}
              onValueChange={(x) =>
                set('priceModel', x === 'none' ? '' : String(x))
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-</SelectItem>
                {PRICE_MODELS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label={m['dash.form.lowest_price']()}>
            <Input
              value={v.lowestPrice}
              onChange={(e) => set('lowestPrice', e.target.value)}
              placeholder="0"
            />
          </F>
        </div>
      </Section>

      {!only && (
        <>
          <Section
            title={m['dash.form.anchors']()}
            desc={m['dash.form.anchors_desc']()}
          >
            <div className="space-y-2">
              {v.links.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={a.name}
                    placeholder={m['dash.form.anchor_text']()}
                    onChange={(e) =>
                      set(
                        'links',
                        v.links.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x
                        )
                      )
                    }
                  />
                  <Input
                    value={a.url}
                    placeholder="https://"
                    onChange={(e) =>
                      set(
                        'links',
                        v.links.map((x, j) =>
                          j === i ? { ...x, url: e.target.value } : x
                        )
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      set(
                        'links',
                        v.links.filter((_, j) => j !== i)
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set('links', [...v.links, { name: v.name, url: v.url }])
                }
              >
                <Plus className="size-4" />
                {m['dash.form.add_anchor']()}
              </Button>
            </div>
          </Section>

          <Section
            title={m['dash.form.agent']()}
            desc={m['dash.form.agent_desc']()}
            extra={
              <Switch
                aria-label={m['dash.form.auto']()}
                checked={v.autoBacklinkEnabled}
                onCheckedChange={(x) => set('autoBacklinkEnabled', x)}
                className="mt-0.5 shrink-0"
              />
            }
          >
            <div className="border-t pt-4">
              <F
                label={m['dash.form.backlink_mgmt']()}
                htmlFor={`${fieldId}-backlink-admin`}
              >
                <Input
                  id={`${fieldId}-backlink-admin`}
                  value={v.backlinkManagementUrl}
                  onChange={(e) => set('backlinkManagementUrl', e.target.value)}
                  placeholder="https://yoursite.com/admin"
                  aria-describedby={`${fieldId}-backlink-admin-hint`}
                />
                <p
                  id={`${fieldId}-backlink-admin-hint`}
                  className="text-muted-foreground text-xs leading-relaxed"
                >
                  {m['dash.form.backlink_mgmt_hint']()}
                </p>
              </F>
            </div>
          </Section>

          <Section
            title={m['dash.form.owner']()}
            desc={m['dash.form.owner_desc']()}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={randomUser}
              >
                {m['dash.form.random_user']()}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <F label={m['dash.form.avatar']()}>
                <ImageUrl
                  value={v.ownerAvatarUrl}
                  onChange={(x) => set('ownerAvatarUrl', x)}
                />
              </F>
              <F label={m['dash.form.first_name']()}>
                <Input
                  value={v.ownerFirstName}
                  onChange={(e) => set('ownerFirstName', e.target.value)}
                />
              </F>
              <F label={m['dash.form.last_name']()}>
                <Input
                  value={v.ownerLastName}
                  onChange={(e) => set('ownerLastName', e.target.value)}
                />
              </F>
              <F label={m['dash.form.owner_email']()}>
                <Input
                  value={v.ownerEmail}
                  onChange={(e) => set('ownerEmail', e.target.value)}
                />
              </F>
              <F label="Twitter">
                <Input
                  value={v.ownerTwitter}
                  onChange={(e) => set('ownerTwitter', e.target.value)}
                />
              </F>
            </div>
          </Section>

          <Section
            title={m['dash.form.social']()}
            desc={m['dash.form.social_desc']()}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL.map(([k, label]) => (
                <F key={k} label={label}>
                  <Input
                    value={v.socialLinks[k] ?? ''}
                    onChange={(e) =>
                      set('socialLinks', {
                        ...v.socialLinks,
                        [k]: e.target.value,
                      })
                    }
                  />
                </F>
              ))}
              <F label={m['dash.form.demo_video']()}>
                <Input
                  value={v.socialLinks.demoVideo ?? ''}
                  onChange={(e) =>
                    set('socialLinks', {
                      ...v.socialLinks,
                      demoVideo: e.target.value,
                    })
                  }
                />
              </F>
              <F label={m['dash.form.explainer_video']()}>
                <Input
                  value={v.socialLinks.explainerVideo ?? ''}
                  onChange={(e) =>
                    set('socialLinks', {
                      ...v.socialLinks,
                      explainerVideo: e.target.value,
                    })
                  }
                />
              </F>
            </div>
          </Section>

          <Section
            title={m['dash.form.location']()}
            desc={m['dash.form.location_desc']()}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={randomAddress}
              >
                {m['dash.form.random_address']()}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <F
                label={m['dash.form.company_founded_year']()}
                hint={m['dash.form.company_founded_year_hint']()}
                wide
              >
                <Input
                  type="number"
                  min={1000}
                  max={new Date().getFullYear()}
                  value={
                    Object.fromEntries(
                      v.metadata.map((item) => [item.key, item.value])
                    )[COMPANY_FOUNDED_YEAR_KEY] ?? ''
                  }
                  onChange={(e) =>
                    set('metadata', [
                      ...v.metadata.filter(
                        (item) => item.key !== COMPANY_FOUNDED_YEAR_KEY
                      ),
                      ...(e.target.value
                        ? [
                            {
                              key: COMPANY_FOUNDED_YEAR_KEY,
                              value: e.target.value,
                            },
                          ]
                        : []),
                    ])
                  }
                />
              </F>
              {(
                [
                  ['country', m['dash.form.country']()],
                  ['state', m['dash.form.state']()],
                  ['city', m['dash.form.city']()],
                  ['zip', m['dash.form.zip']()],
                ] as const
              ).map(([k, label]) => (
                <F key={k} label={label}>
                  <Input
                    value={v.location[k] ?? ''}
                    onChange={(e) =>
                      set('location', { ...v.location, [k]: e.target.value })
                    }
                  />
                </F>
              ))}
              <F label={m['dash.form.address']()} wide>
                <Input
                  value={v.location.address ?? ''}
                  onChange={(e) =>
                    set('location', { ...v.location, address: e.target.value })
                  }
                />
              </F>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

export type SiteMeta = {
  url: string;
  name: string;
  tagline: string;
  shortDesc: string;
  iconUrl: string;
  screenshotUrl: string;
  twitter: string;
  email: string;
  keywords: string[];
  socialLinks: Record<string, string>;
};

/** Fill only what's still empty — never overwrite the user's text. */
export function mergeMeta(form: WebsiteForm, meta: SiteMeta): WebsiteForm {
  return {
    ...form,
    name: form.name || meta.name,
    email: form.email || meta.email,
    tags: form.tags.length ? form.tags : meta.keywords,
    tagline: form.tagline || meta.tagline,
    shortDesc: form.shortDesc || meta.shortDesc,
    iconUrl: form.iconUrl || meta.iconUrl,
    screenshotUrls: form.screenshotUrls.length
      ? form.screenshotUrls
      : meta.screenshotUrl
        ? [meta.screenshotUrl]
        : [],
    socialLinks: {
      ...Object.fromEntries(
        Object.entries(meta.socialLinks).filter(([k]) => !form.socialLinks[k])
      ),
      ...form.socialLinks,
      twitter:
        form.socialLinks.twitter ||
        (meta.twitter ? `https://x.com/${meta.twitter.replace(/^@/, '')}` : ''),
    },
  };
}
