import { createFileRoute } from '@tanstack/react-router';
import {
  PLAZA_WRITE_PERMISSION,
  withPermission,
} from '@/server/backlinks/auth';

import { allPlaza } from '@/modules/backlinks/library';
import { csvResponse, toCsv } from '@/lib/csv';

const GET = withPermission(PLAZA_WRITE_PERMISSION, async () => {
  const rows = await allPlaza();
  const csv = toCsv(
    [
      'name',
      'link',
      'category',
      'tags',
      'cost_type',
      'link_type',
      'language',
      'dr',
      'organic_traffic',
      'status',
      'quality',
      'confidence',
      'details',
      'tips',
    ],
    rows.map((r) => [
      r.name,
      r.link,
      r.category,
      r.tags.join(','),
      r.costType,
      r.linkType,
      r.language,
      r.dr ?? '',
      r.organicTraffic ?? '',
      r.status,
      r.quality,
      r.confidence,
      r.details,
      r.tips,
    ])
  );
  return csvResponse('backlink-plaza.csv', csv);
});

export const Route = createFileRoute('/api/backlinks/export')({
  server: { handlers: { GET } },
});
