export interface FooterBadge {
  href: string;
  src?: string;
  alt: string;
  text?: string;
  rel?: string;
  attributes?: Record<string, string>;
  imageAttributes?: Record<string, string>;
  width?: number;
  height?: number;
}

export const MAX_FOOTER_BADGES = 200;

const MAX_ALT_LENGTH = 120;

/** Only inert metadata is spread onto rendered elements, never event/style/URL props. */
export function badgeAttributes(
  value: unknown
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid badge attributes');
  const entries = Object.entries(value);
  if (entries.length > 12) throw new Error('Too many badge attributes');
  for (const [key, item] of entries) {
    if (
      !/^(title|aria-label|data-[a-z][a-z0-9-]{0,60})$/.test(key) ||
      typeof item !== 'string' ||
      item.length > 500
    )
      throw new Error('Invalid badge attribute');
  }
  return Object.fromEntries(entries);
}

export function badgeRel(value: unknown): string {
  const tokens =
    typeof value === 'string' ? value.toLowerCase().split(/\s+/) : [];
  return [
    ...new Set([
      'noopener',
      'noreferrer',
      ...tokens.filter((t) => ['nofollow', 'sponsored', 'ugc'].includes(t)),
    ]),
  ].join(' ');
}

function safeHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(`${field} must be an HTTPS URL`);
  }

  return url.toString();
}

function optionalDimension(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(
      `${field} must be a positive integer no greater than ${max}`
    );
  }
  return number;
}

export function validateFooterBadges(value: unknown): FooterBadge[] {
  if (!Array.isArray(value) || value.length > MAX_FOOTER_BADGES) {
    throw new Error(
      `A maximum of ${MAX_FOOTER_BADGES} footer badges is allowed`
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Footer badge ${index + 1} is invalid`);
    }

    const badge = item as Record<string, unknown>;
    const href = safeHttpsUrl(badge.href, `Badge ${index + 1} link`);
    const src = badge.src
      ? safeHttpsUrl(badge.src, `Badge ${index + 1} image`)
      : undefined;
    const text = typeof badge.text === 'string' ? badge.text.trim() : '';
    const alt = typeof badge.alt === 'string' ? badge.alt.trim() : '';

    if (!alt || alt.length > MAX_ALT_LENGTH) {
      throw new Error(
        `Badge ${index + 1} alt text must be 1-${MAX_ALT_LENGTH} characters`
      );
    }

    if ((!src && !text) || text.length > 200)
      throw new Error(
        'A badge needs an image or link text (up to 200 characters)'
      );

    return {
      href,
      src,
      alt,
      ...(text ? { text } : {}),
      rel: badgeRel(badge.rel),
      attributes: badgeAttributes(badge.attributes),
      imageAttributes: badgeAttributes(badge.imageAttributes),
      width: optionalDimension(badge.width, `Badge ${index + 1} width`, 1000),
      height: optionalDimension(badge.height, `Badge ${index + 1} height`, 600),
    };
  });
}

export function parseStoredFooterBadges(value?: string): FooterBadge[] {
  if (!value) return [];
  try {
    const items = JSON.parse(value);
    if (!Array.isArray(items)) return [];
    // One malformed legacy entry must not hide every valid public badge.
    return items.slice(0, MAX_FOOTER_BADGES).flatMap((item) => {
      try {
        return validateFooterBadges([item]);
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
