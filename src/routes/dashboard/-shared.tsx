import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink as ExternalIcon } from 'lucide-react';

import type {
  BacklinkCategory,
  CostType,
  LinkStatus,
  OperationStatus,
  Quality,
} from '@/config/backlinks';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types (API shapes) ─────────────────────────────────────────────────────

export interface Backlink {
  id: string;
  name: string;
  link: string;
  domain: string;
  tags: string[];
  category: BacklinkCategory;
  costType: CostType;
  linkType: string;
  language: string;
  details: string;
  tips: string;
  dr: number | null;
  organicTraffic: number | null;
  status: string;
  quality: Quality;
  confidence: string;
  visibility: 'public' | 'private';
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyBacklink extends Backlink {
  libraryId: string;
  source: 'favorite' | 'own';
  personalQuality: Quality;
  notes: string;
  enabled: boolean;
  isOwner: boolean;
}

export interface WebsiteCounts {
  total: number;
  inProgress: number;
  done: number;
  failed: number;
  pending: number;
}

export interface Website {
  id: string;
  status: 'enabled' | 'disabled';
  name: string;
  url: string;
  internalNote: string;
  email: string;
  launchDate: string;
  iconUrl: string;
  screenshotUrls: string[];
  shortDesc: string;
  longDesc: string;
  tagline: string;
  slogan: string;
  categories: string[];
  tags: string[];
  priceModel: string;
  lowestPrice: string;
  links: { name: string; url: string }[];
  backlinkManagementUrl: string;
  emailManagementUrl: string;
  autoBacklinkEnabled: boolean;
  agentSubmissionNote: string;
  ownerAvatarUrl: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerTwitter: string;
  socialLinks: Record<string, string>;
  location: Record<string, string>;
  metadata: { key: string; value: string }[];
  counts?: WebsiteCounts;
  createdAt: string;
  updatedAt: string;
}

export interface Readiness {
  ready: boolean;
  blocking_fields: string[];
  missing_fields: string[];
  invalid_fields: string[];
}

export interface WebsiteRecord {
  id: string;
  websiteId: string;
  websiteName: string | null;
  backlinkId: string | null;
  sourceDomain: string;
  sourceUrl: string;
  targetDomain: string;
  targetUrl: string;
  description: string;
  userNotes: string;
  operationStatus: OperationStatus;
  linkStatus: LinkStatus;
  resultUrl: string | null;
  proof: string | null;
  needsUser: string | null;
  claimedBy: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  submittedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Paged<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number };
};

export interface Facets {
  total: number;
  recommended: number;
  categories: Record<BacklinkCategory, number>;
  tags: { tag: string; count: number }[];
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export const categoryLabel: Record<BacklinkCategory, () => string> = {
  directory: m['dash.category.directory'],
  blog_comment: m['dash.category.blog_comment'],
  forum_community: m['dash.category.forum_community'],
  content_submission: m['dash.category.content_submission'],
  profile: m['dash.category.profile'],
  review_platform: m['dash.category.review_platform'],
  other: m['dash.category.other'],
};

export const costLabel: Record<CostType, () => string> = {
  unknown: m['dash.cost.unknown'],
  free: m['dash.cost.free'],
  freemium: m['dash.cost.freemium'],
  paid: m['dash.cost.paid'],
};

export const qualityLabel: Record<Quality, () => string> = {
  unrated: m['dash.quality.unrated'],
  good: m['dash.quality.good'],
  normal: m['dash.quality.normal'],
  bad: m['dash.quality.bad'],
};

// ─── Small components ──────────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'text-primary inline-flex max-w-full items-center gap-1 break-all hover:underline',
        className
      )}
    >
      <span className="min-w-0 truncate">{children ?? href}</span>
      <ExternalIcon className="size-3.5 shrink-0" />
    </a>
  );
}

export function TagList({ tags, max = 4 }: { tags: string[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <Badge key={t} variant="secondary" className="font-normal">
          {t}
        </Badge>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'approved' || status === 'live' || status === 'valid'
      ? 'bg-primary text-primary-foreground'
      : status === 'rejected' || status === 'blocked'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-foreground';
  return <Badge className={cn('border-0 font-normal', tone)}>{status}</Badge>;
}

export function QualityPill({ quality }: { quality: Quality }) {
  return (
    <Badge
      variant={quality === 'good' ? 'default' : 'outline'}
      className="font-normal"
    >
      {quality === 'unrated'
        ? m['dash.quality.unknown']()
        : qualityLabel[quality]()}
    </Badge>
  );
}

/** A labeled filter select whose first option means "no filter". */
export function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange((v as string) || 'all')}
      items={[{ value: 'all', label: allLabel }, ...options]}
    >
      <SelectTrigger className={cn('h-9 w-[160px]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Raw enum select (statuses are shown as their stored values). */
export function EnumSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-9 w-[140px]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAGE_SIZES = [10, 20, 50, 100];

/** 第 x 页，共 n 页，共 t 条 · 每页 · 首页 上一页 1 2 3 下一页 尾页 */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (s: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="text-muted-foreground flex items-center gap-2">
        <span>{m['dash.pager.summary']({ page, pages, total })}</span>
        {onPageSize && (
          <>
            <span>{m['dash.pager.per_page']()}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => v && onPageSize(Number(v))}
            >
              <SelectTrigger className="h-9 w-[84px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(1)}
        >
          {m['dash.pager.first']()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {m['dash.pager.prev']()}
        </Button>
        {nums.map((n) => (
          <Button
            key={n}
            variant={n === page ? 'default' : 'outline'}
            size="sm"
            className="min-w-8"
            onClick={() => onPage(n)}
          >
            {n}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {m['dash.pager.next']()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(pages)}
        >
          {m['dash.pager.last']()}
        </Button>
      </div>
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="text-muted-foreground py-16 text-center text-sm"
      >
        {text}
      </td>
    </tr>
  );
}

export function SiteIcon({
  site,
  size = 40,
}: {
  site: Pick<Website, 'name' | 'iconUrl'>;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  if (site.iconUrl && !broken) {
    return (
      <img
        src={site.iconUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-lg border object-cover"
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className="bg-primary text-primary-foreground flex items-center justify-center rounded-lg font-semibold"
      style={{ width: size, height: size }}
    >
      {site.name.charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useWebsiteOptions() {
  return useQuery({
    queryKey: ['website-options'],
    queryFn: () =>
      apiGet<{ id: string; name: string; url: string }[]>(
        '/api/websites/options'
      ),
  });
}

export function useCanManagePlaza() {
  const q = useQuery({
    queryKey: ['plaza-can-manage'],
    queryFn: () => apiGet<{ canManage: boolean }>('/api/backlinks/can-manage'),
  });
  return q.data?.canManage ?? false;
}

export function useFacets(scope: 'plaza' | 'personal', enabled = true) {
  return useQuery({
    queryKey: ['backlink-facets', scope],
    queryFn: () => apiGet<Facets>(`/api/backlinks/facets?scope=${scope}`),
    enabled,
  });
}

/** Query string from an object, skipping empty and "all" values. */
export function qs(
  params: Record<string, string | number | boolean | undefined>
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === 'all' || v === false) continue;
    sp.set(k, v === true ? '1' : String(v));
  }
  return sp.toString();
}

/** Download a same-origin file URL (keeps the session cookie). */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function formatTime(v: string | null | undefined) {
  if (!v) return '-';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function readFileText(file: File, maxBytes = 5_000_000) {
  if (file.size > maxBytes) throw new Error(m['dash.common.file_too_large']());
  return file.text();
}
