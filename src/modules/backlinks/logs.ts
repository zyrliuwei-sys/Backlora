import { and, count, desc, eq, like, or, type SQL } from 'drizzle-orm';

import { db } from '@/core/db';
import { LOG_ACTIONS, LOG_VISIBILITIES, oneOf } from '@/config/backlinks';
import { backlink, backlinkLog, website } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

import { getVisibleBacklink } from './library';
import { BacklinkError, str } from './shared';
import { requireWebsite } from './websites';

export async function listLogs(
  userId: string,
  f: {
    page: number;
    pageSize: number;
    search?: string;
    action?: string;
    status?: string;
    visibility?: string;
    websiteId?: string;
  }
) {
  const c: SQL[] = [eq(backlinkLog.userId, userId)];
  if (f.websiteId) c.push(eq(backlinkLog.websiteId, f.websiteId));
  if (oneOf(f.action, LOG_ACTIONS)) c.push(eq(backlinkLog.action, f.action));
  if (f.status) c.push(eq(backlinkLog.status, f.status));
  if (oneOf(f.visibility, LOG_VISIBILITIES))
    c.push(eq(backlinkLog.visibility, f.visibility));
  if (f.search) {
    const q = `%${f.search}%`;
    c.push(
      or(
        like(backlink.name, q),
        like(backlink.link, q),
        like(website.name, q),
        like(backlinkLog.action, q),
        like(backlinkLog.notes, q)
      )!
    );
  }
  const where = and(...c);
  const base = () =>
    db()
      .select({
        id: backlinkLog.id,
        action: backlinkLog.action,
        notes: backlinkLog.notes,
        status: backlinkLog.status,
        visibility: backlinkLog.visibility,
        createdAt: backlinkLog.createdAt,
        backlinkId: backlinkLog.backlinkId,
        backlinkName: backlink.name,
        backlinkLink: backlink.link,
        websiteId: backlinkLog.websiteId,
        websiteName: website.name,
      })
      .from(backlinkLog)
      .innerJoin(backlink, eq(backlink.id, backlinkLog.backlinkId))
      .leftJoin(website, eq(website.id, backlinkLog.websiteId));
  const [{ total }] = await db()
    .select({ total: count() })
    .from(backlinkLog)
    .innerJoin(backlink, eq(backlink.id, backlinkLog.backlinkId))
    .leftJoin(website, eq(website.id, backlinkLog.websiteId))
    .where(where);
  const list = await base()
    .where(where)
    .orderBy(desc(backlinkLog.createdAt))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  return { list, total };
}

export async function createLog(userId: string, body: any) {
  const b = await getVisibleBacklink(userId, str(body?.backlinkId, 100));
  if (!b) throw new BacklinkError('Backlink not found', 404);
  const websiteId = str(body?.websiteId, 100) || null;
  if (websiteId) await requireWebsite(userId, websiteId);
  const [row] = await db()
    .insert(backlinkLog)
    .values({
      id: getUuid(),
      userId,
      backlinkId: b.id,
      websiteId,
      action: oneOf(body?.action, LOG_ACTIONS) ? body.action : 'comment',
      notes: str(body?.notes, 4000),
      visibility: oneOf(body?.visibility, LOG_VISIBILITIES)
        ? body.visibility
        : 'private',
    })
    .returning();
  return row;
}

export async function deleteLog(userId: string, id: string) {
  await db()
    .delete(backlinkLog)
    .where(and(eq(backlinkLog.id, id), eq(backlinkLog.userId, userId)));
}
