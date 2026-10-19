import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Download, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { PRICE_MODELS } from '@/config/backlinks';
import { apiPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { mergeMeta, type SiteMeta, type WebsiteForm } from './-website-form';

/** Lists (categories, tags, links, metadata) keep at most this many items. */
const ITEM_LIMIT = 5;

/**
 * The JSON an AI fills in. Flat keys, the same shape Submify's "Codex import"
 * uses, so a model needs no knowledge of our nested form.
 */
const TEMPLATE = {
  url: '',
  userAvatar: '',
  userFirstName: '',
  userLastName: '',
  userEmail: '',
  userTwitter: '',
  name: '',
  email: '',
  launchDate: '',
  shortDesc: '',
  longDesc: '',
  icon: '',
  screenshot1: '',
  screenshot2: '',
  tagline: '',
  slogan: '',
  categories: [] as string[],
  tags: [] as string[],
  priceModel: '',
  lowestPrice: '',
  socialFacebook: '',
  socialTwitter: '',
  socialLinkedin: '',
  socialInstagram: '',
  socialYoutube: '',
  socialGithub: '',
  demoVideo: '',
  explainerVideo: '',
  locationCountry: '',
  locationState: '',
  locationCity: '',
  locationZipcode: '',
  locationAddress: '',
  metaData: [] as { key: string; value: string }[],
  links: [] as { name: string; url: string }[],
};

const FIELD_NOTES: Partial<Record<keyof typeof TEMPLATE, string>> = {
  url: 'Canonical public homepage URL',
  userAvatar: 'Public founder or owner avatar URL',
  userFirstName: 'Public founder or owner first name',
  userLastName: 'Public founder or owner last name',
  userEmail: 'Public founder or owner email',
  userTwitter: 'Public founder or owner Twitter/X URL or handle',
  name: 'Product or website name',
  email: 'Public product support or contact email',
  launchDate: 'Launch date in YYYY-MM-DD format',
  shortDesc: 'Concise one-sentence product description',
  longDesc: 'Detailed product description',
  icon: 'Absolute logo or favicon URL',
  screenshot1: 'Absolute primary product image or screenshot URL',
  screenshot2: 'Absolute secondary product image or screenshot URL',
  tagline: 'Short product tagline',
  slogan: 'Product slogan',
  categories: `Up to ${ITEM_LIMIT} product categories`,
  tags: `Up to ${ITEM_LIMIT} keywords`,
  priceModel: `One of: ${PRICE_MODELS.join(', ')}`,
  lowestPrice: 'Lowest public price including currency and billing period',
  socialFacebook: 'Official Facebook URL',
  socialTwitter: 'Official X or Twitter URL',
  socialLinkedin: 'Official LinkedIn URL',
  socialInstagram: 'Official Instagram URL',
  socialYoutube: 'Official YouTube URL',
  socialGithub: 'Official GitHub URL',
  demoVideo: 'Absolute product demo video URL',
  explainerVideo: 'Absolute product explainer video URL',
  locationCountry: 'Public company country',
  locationState: 'Public company state or province',
  locationCity: 'Public company city',
  locationZipcode: 'Public company postal code',
  locationAddress: 'Public company street address',
  metaData: `Up to ${ITEM_LIMIT} extra { key, value } facts useful for directory forms`,
  links: `Up to ${ITEM_LIMIT} { name, url } important pages of the product, used as comment anchors`,
};

export function importPrompt(url: string) {
  const template = { ...TEMPLATE, url, links: [{ name: '', url }] };
  const notes = Object.entries(FIELD_NOTES)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return `${m['dash.import.prompt_instruction']({ url })}

${notes}

\`\`\`json
${JSON.stringify(template, null, 2)}
\`\`\``;
}

/** Pull the JSON object out of an AI reply (code fence or bare). */
export function parseImportJson(text: string): Record<string, unknown> {
  const body =
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() || text.trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('invalid_json');
  const v = JSON.parse(body.slice(start, end + 1));
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('invalid_json');
  return v as Record<string, unknown>;
}

const clean = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';

function httpUrl(v: unknown): string {
  const s = clean(v);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function email(v: unknown): string {
  const s = clean(v)
    .replace(/^mailto:/i, '')
    .split('?', 1)[0];
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** A URL on one of the given hosts (or their subdomains), else empty. */
function onHost(v: unknown, hosts: string[]): string {
  const s = httpUrl(v);
  if (!s) return '';
  const host = new URL(s).hostname.replace(/^www\./, '').toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`)) ? s : '';
}

function list(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[,;|]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = clean(item);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= ITEM_LIMIT) break;
  }
  return out;
}

function pairs<K extends string, V extends string>(
  v: unknown,
  k: K,
  val: V,
  check: (s: unknown) => string
) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
    )
    .map(
      (x) =>
        ({ [k]: clean(x[k]), [val]: check(x[val]) }) as Record<K | V, string>
    )
    .filter((x) => x[k] && x[val])
    .slice(0, ITEM_LIMIT);
}

const SOCIAL_HOSTS: [keyof typeof TEMPLATE, string, string[]][] = [
  ['socialFacebook', 'facebook', ['facebook.com']],
  ['socialTwitter', 'twitter', ['x.com', 'twitter.com']],
  ['socialLinkedin', 'linkedin', ['linkedin.com']],
  ['socialInstagram', 'instagram', ['instagram.com']],
  ['socialYoutube', 'youtube', ['youtube.com', 'youtu.be']],
  ['socialGithub', 'github', ['github.com']],
];

/**
 * Fill the form from an imported JSON. Only empty fields are filled, never
 * the user's own text; invalid URLs and emails are dropped. Returns the
 * number of fields that changed.
 */
export function applyImport(form: WebsiteForm, data: Record<string, unknown>) {
  const next: WebsiteForm = {
    ...form,
    socialLinks: { ...form.socialLinks },
    location: { ...form.location },
  };
  let count = 0;
  const fill = (current: string, value: string, set: (v: string) => void) => {
    if (!current.trim() && value) {
      set(value);
      count++;
    }
  };
  const text = (k: keyof typeof TEMPLATE) => clean(data[k]);

  fill(form.name, text('name'), (v) => (next.name = v));
  fill(form.email, email(data.email), (v) => (next.email = v));
  fill(
    form.launchDate,
    /^\d{4}-\d{2}-\d{2}$/.test(text('launchDate')) ? text('launchDate') : '',
    (v) => (next.launchDate = v)
  );
  fill(form.shortDesc, text('shortDesc'), (v) => (next.shortDesc = v));
  // Keep line breaks of the long description.
  fill(
    form.longDesc,
    typeof data.longDesc === 'string' ? data.longDesc.trim() : '',
    (v) => (next.longDesc = v)
  );
  fill(form.iconUrl, httpUrl(data.icon), (v) => (next.iconUrl = v));
  fill(form.tagline, text('tagline'), (v) => (next.tagline = v));
  fill(form.slogan, text('slogan'), (v) => (next.slogan = v));
  fill(form.lowestPrice, text('lowestPrice'), (v) => (next.lowestPrice = v));
  fill(
    form.ownerAvatarUrl,
    httpUrl(data.userAvatar),
    (v) => (next.ownerAvatarUrl = v)
  );
  fill(
    form.ownerFirstName,
    text('userFirstName'),
    (v) => (next.ownerFirstName = v)
  );
  fill(
    form.ownerLastName,
    text('userLastName'),
    (v) => (next.ownerLastName = v)
  );
  fill(form.ownerEmail, email(data.userEmail), (v) => (next.ownerEmail = v));
  fill(form.ownerTwitter, text('userTwitter'), (v) => (next.ownerTwitter = v));

  const model = text('priceModel')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  fill(
    form.priceModel,
    (PRICE_MODELS as readonly string[]).includes(model) ? model : '',
    (v) => (next.priceModel = v)
  );

  for (const [key, social, hosts] of SOCIAL_HOSTS)
    fill(
      form.socialLinks[social] ?? '',
      onHost(data[key], hosts),
      (v) => (next.socialLinks[social] = v)
    );
  fill(
    form.socialLinks.demoVideo ?? '',
    httpUrl(data.demoVideo),
    (v) => (next.socialLinks.demoVideo = v)
  );
  fill(
    form.socialLinks.explainerVideo ?? '',
    httpUrl(data.explainerVideo),
    (v) => (next.socialLinks.explainerVideo = v)
  );

  for (const [key, loc] of [
    ['locationCountry', 'country'],
    ['locationState', 'state'],
    ['locationCity', 'city'],
    ['locationZipcode', 'zip'],
    ['locationAddress', 'address'],
  ] as const)
    fill(form.location[loc] ?? '', text(key), (v) => (next.location[loc] = v));

  if (!form.screenshotUrls.length) {
    const shots = [httpUrl(data.screenshot1), httpUrl(data.screenshot2)].filter(
      Boolean
    );
    if (shots.length) {
      next.screenshotUrls = shots;
      count++;
    }
  }
  for (const key of ['categories', 'tags'] as const) {
    const items = list(data[key]);
    if (!form[key].length && items.length) {
      next[key] = items;
      count++;
    }
  }
  const metadata = pairs(data.metaData, 'key', 'value', clean);
  if (!form.metadata.length && metadata.length) {
    next.metadata = metadata;
    count++;
  }
  const links = pairs(data.links, 'name', 'url', httpUrl);
  if (!form.links.length && links.length) {
    next.links = links;
    count++;
  }
  return { form: next, count };
}

/** 导入资料: read the page's meta tags, or paste the JSON an AI filled in. */
export function ProfileImportDialog({
  open,
  onOpenChange,
  form,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: WebsiteForm;
  onImport: (form: WebsiteForm) => void;
}) {
  const [json, setJson] = useState('');
  const url = form.url.trim();

  const readMeta = useMutation({
    mutationFn: () => apiPost<SiteMeta>('/api/websites/fetch-meta', { url }),
    onSuccess: (meta) => {
      onImport(mergeMeta(form, meta));
      toast.success(m['dash.form.meta_loaded']());
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (text: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(ok);
    } catch {
      toast.error(m['dash.common.copy_failed']());
    }
  };
  const parsed = () => {
    if (!json.trim()) {
      toast.error(m['dash.import.json_required']());
      return null;
    }
    try {
      return parseImportJson(json);
    } catch {
      toast.error(m['dash.import.json_invalid']());
      return null;
    }
  };
  const apply = () => {
    const data = parsed();
    if (!data) return;
    const r = applyImport(form, data);
    onImport(r.form);
    toast.success(m['dash.import.applied']({ count: r.count }));
    setJson('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m['dash.import.title']()}</DialogTitle>
          <DialogDescription>{m['dash.import.desc']()}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="metadata">
          <TabsList>
            <TabsTrigger value="metadata">
              {m['dash.import.metadata']()}
            </TabsTrigger>
            <TabsTrigger value="codex">{m['dash.import.codex']()}</TabsTrigger>
          </TabsList>
          <TabsContent value="metadata" className="space-y-4 pt-2">
            <p className="text-muted-foreground text-sm leading-6">
              {m['dash.import.metadata_desc']()}
            </p>
            <Button
              disabled={!url || readMeta.isPending}
              onClick={() => readMeta.mutate()}
            >
              {readMeta.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {readMeta.isPending
                ? m['dash.import.reading']()
                : m['dash.form.fetch_meta']()}
            </Button>
          </TabsContent>
          <TabsContent value="codex" className="space-y-4 pt-2">
            <p className="text-muted-foreground text-sm leading-6">
              {m['dash.import.codex_desc']()}
            </p>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{m['dash.import.prompt_label']()}</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!url}
                    onClick={() =>
                      copy(importPrompt(url), m['dash.import.prompt_copied']())
                    }
                  >
                    <Copy className="size-4" />
                    {m['dash.import.copy_prompt']()}
                  </Button>
                  <a
                    href="https://chatgpt.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center text-sm hover:underline"
                  >
                    {m['dash.import.open_chatgpt']()}
                  </a>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {m['dash.import.prompt_help']()}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="profile-import-json">
                  {m['dash.import.json_label']()}
                </Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const data = parsed();
                      if (data) setJson(JSON.stringify(data, null, 2));
                    }}
                  >
                    {m['dash.import.format_json']()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      json.trim() && copy(json, m['dash.common.copied']())
                    }
                  >
                    {m['dash.import.copy_json']()}
                  </Button>
                </div>
              </div>
              <Textarea
                id="profile-import-json"
                className="h-56 font-mono text-xs"
                value={json}
                placeholder={m['dash.import.json_placeholder']()}
                onChange={(e) => setJson(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {m['dash.import.json_help']()}
              </p>
            </div>
            <Button onClick={apply}>
              <Wand2 className="size-4" />
              {m['dash.import.apply']()}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
