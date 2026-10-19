import { domainOf, type LinkStatus } from '@/config/backlinks';

import { PRIVATE_HOST } from './fetch-meta';

const MAX_REDIRECTS = 5;

/** GET a public page, following redirects by hand so none lands on a private host. */
async function fetchPage(url: string) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname))
      return null;
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  return null;
}

function sameSite(host: string, domain: string) {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h === domain || h.endsWith(`.${domain}`);
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function attrOf(tag: string, name: string): string {
  const m = tag.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/&amp;/g, '&').trim();
}

/**
 * Whether `pageUrl` still links to `domain`:
 * - `valid` / `nofollow` (rel has nofollow, ugc or sponsored): a direct link;
 * - `redirected`: only through a redirect/tracking URL that carries the domain;
 * - `missing`, `noindex`, `http_4xx`, `http_5xx` otherwise.
 * Returns null when the page can't be reached or blocks bots (status is left
 * as it was).
 */
export async function checkLink(
  pageUrl: string,
  linkUrl: string
): Promise<LinkStatus | null> {
  const domain = domainOf(linkUrl).toLowerCase();
  let page: Awaited<ReturnType<typeof fetchPage>>;
  try {
    page = await fetchPage(pageUrl);
  } catch {
    return null;
  }
  if (!page) return null;
  const { res, finalUrl } = page;
  // Bot walls (Cloudflare challenges, rate limits) say nothing about the link.
  if ([401, 403, 407, 429].includes(res.status)) return null;
  if (res.status >= 500) return 'http_5xx';
  if (res.status >= 400) return 'http_4xx';

  const html = (await res.text()).slice(0, 2_000_000);
  let direct: 'valid' | 'nofollow' | null = null;
  let indirect = false;
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attrOf(tag, 'href');
    if (!href || /^(#|mailto:|javascript:)/i.test(href)) continue;
    let target: URL;
    try {
      target = new URL(href, finalUrl);
    } catch {
      continue;
    }
    if (sameSite(target.hostname, domain)) {
      const follow = !/\b(nofollow|ugc|sponsored)\b/i.test(attrOf(tag, 'rel'));
      direct = follow ? 'valid' : (direct ?? 'nofollow');
      if (follow) break;
    } else if (safeDecode(target.search).toLowerCase().includes(domain)) {
      indirect = true;
    }
  }
  if (!direct && !indirect) return 'missing';

  const robots =
    (res.headers.get('x-robots-tag') ?? '') +
    ' ' +
    [...html.matchAll(/<meta\b[^>]*>/gi)]
      .map(([tag]) =>
        /^(robots|googlebot)$/i.test(attrOf(tag, 'name'))
          ? attrOf(tag, 'content')
          : ''
      )
      .join(' ');
  if (/\bnoindex\b/i.test(robots)) return 'noindex';
  return direct ?? 'redirected';
}
