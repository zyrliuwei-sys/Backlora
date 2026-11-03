import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/core/db';
import { config, website } from '@/config/db/schema';
import { decryptSecret, isEncryptedSecret } from '@/lib/crypto';

export function badgeConnectionKey(websiteId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(websiteId))
    throw new Error('Invalid website id');
  return `badge_connection_${websiteId}_secret`;
}

export async function ownedBadgeWebsite(userId: string, websiteId: string) {
  const [row] = await db()
    .select({
      id: website.id,
      url: website.url,
      enabled: website.autoBacklinkEnabled,
      status: website.status,
    })
    .from(website)
    .where(
      and(
        eq(website.id, websiteId),
        eq(website.userId, userId),
        isNull(website.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export type BadgeConnection = { version: 1; origin: string; token: string };

/** Read directly; a removed/rotated connection must not survive a config cache. */
export async function readBadgeConnection(
  websiteId: string
): Promise<BadgeConnection | null> {
  const [row] = await db()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.name, badgeConnectionKey(websiteId)))
    .limit(1);
  if (!row?.value || !isEncryptedSecret(row.value)) return null;
  const plain = await decryptSecret(row.value);
  if (!plain) return null;
  try {
    const value = JSON.parse(plain);
    return value?.version === 1 &&
      typeof value.origin === 'string' &&
      /^bbg_[A-Za-z0-9_-]{43}$/.test(value.token)
      ? value
      : null;
  } catch {
    return null;
  }
}
