export class BadgeBridgeError extends Error {
  constructor(
    public stage: string,
    message: string,
    public status = 409
  ) {
    super(message);
  }
}

export function allowedBadgeOrigin(raw: string, allowedHosts: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadgeBridgeError('configuration', 'Invalid website URL', 400);
  }
  const hosts = new Set(
    allowedHosts
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname)
  )
    throw new BadgeBridgeError(
      'configuration',
      'Badge integration is not enabled for this website host'
    );
  return url.origin;
}

export async function readLimitedResponse(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BadgeBridgeError(
        'response',
        'Badge response exceeds the size limit'
      );
    }
    text += decoder.decode(value, { stream: true });
  }
}
