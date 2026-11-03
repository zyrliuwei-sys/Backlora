import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

// One credential per website. Keep the resulting file outside the repository.
const [flag, output, ...extra] = process.argv.slice(2);
if (flag !== '--output' || !output || !isAbsolute(output) || extra.length) {
  console.error(
    'Usage: node scripts/create-badge-credential.mjs --output /absolute/private/path.json'
  );
  process.exitCode = 1;
} else {
  const token = `bbg_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    await writeFile(
      output,
      JSON.stringify(
        { token, FOOTER_BADGE_AUTOMATION_TOKEN_HASH: tokenHash },
        null,
        2
      ) + '\n',
      { flag: 'wx', mode: 0o600 }
    );
    console.log(
      'Badge credential saved to the requested private file. No credential was printed.'
    );
  } catch {
    console.error(
      'Cannot create credential file. Use a new path in an existing private directory.'
    );
    process.exitCode = 1;
  }
}
