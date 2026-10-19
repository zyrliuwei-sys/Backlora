import { normalizeUrl } from '@/config/backlinks';
import { BacklinkError } from '@/modules/backlinks/shared';

export const PRIVATE_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

function attr(html: string, pattern: RegExp): string {
  const m = html.match(pattern);
  return m ? decode(m[1]).trim() : '';
}

function meta(html: string, name: string): string {
  const esc = name.replace(/[:.]/g, '\\$&');
  return (
    attr(
      html,
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${esc}["'][^>]*content=["']([^"']*)["']`,
        'i'
      )
    ) ||
    attr(
      html,
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${esc}["']`,
        'i'
      )
    )
  );
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absolute(href: string, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

/** Read a site's title, description and images to pre-fill a project. */
export async function fetchSiteMeta(input: string) {
  const url = normalizeUrl(input);
  if (!url) throw new BacklinkError('Invalid URL');
  if (PRIVATE_HOST.test(new URL(url).hostname)) {
    throw new BacklinkError('Private addresses are not allowed');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch {
    throw new BacklinkError('Could not reach the site');
  }
  if (!res.ok) throw new BacklinkError(`Site responded ${res.status}`);
  const html = (await res.text()).slice(0, 500_000);
  const base = res.url || url;

  const title =
    meta(html, 'og:title') || attr(html, /<title[^>]*>([^<]*)<\/title>/i);
  const description = meta(html, 'description') || meta(html, 'og:description');
  const icon =
    attr(
      html,
      /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i
    ) ||
    attr(
      html,
      /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i
    ) ||
    '/favicon.ico';

  return {
    url,
    name: (
      meta(html, 'og:site_name') ||
      title.split(/\s[-|–—·]\s/)[0] ||
      ''
    ).slice(0, 200),
    tagline: title.slice(0, 200),
    shortDesc: description.slice(0, 1000),
    iconUrl: absolute(icon, base),
    screenshotUrl: absolute(meta(html, 'og:image'), base),
    twitter: meta(html, 'twitter:site') || meta(html, 'twitter:creator'),
  };
}
