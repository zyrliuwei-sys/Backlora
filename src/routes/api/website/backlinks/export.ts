import { createFileRoute } from '@tanstack/react-router';
import { recordFilters, withSession } from '@/server/backlinks/auth';

import { EXPORT_COLUMNS, exportRecords } from '@/modules/backlinks/records';
import { csvResponse, toCsv } from '@/lib/csv';

const GET = withSession(async ({ request, userId }) => {
  const rows = await exportRecords(
    userId,
    recordFilters(new URL(request.url).searchParams)
  );
  return csvResponse('website-backlinks.csv', toCsv([...EXPORT_COLUMNS], rows));
});

export const Route = createFileRoute('/api/website/backlinks/export')({
  server: { handlers: { GET } },
});
