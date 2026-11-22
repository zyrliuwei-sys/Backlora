export const PAVO_SUBMISSION_EMAIL = 'submit@pavoai.net';

export interface VerificationMailbox {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number }
  ): Promise<void>;
}

type MailBindings = {
  BACKLORA_MAIL_WEBSITE_ID?: string;
  BACKLORA_SUBMISSION_DOMAINS?: string;
  VERIFICATION_MAIL?: VerificationMailbox;
};

export function mailBindings(): MailBindings {
  return (globalThis as { __CF_ENV__?: MailBindings }).__CF_ENV__ ?? {};
}

function submissionDomains(env: MailBindings): Record<string, string> {
  if (!env.VERIFICATION_MAIL) return {};
  if (!env.BACKLORA_SUBMISSION_DOMAINS)
    return env.BACKLORA_MAIL_WEBSITE_ID
      ? { [env.BACKLORA_MAIL_WEBSITE_ID]: 'pavoai.net' }
      : {};
  try {
    const configured: unknown = JSON.parse(env.BACKLORA_SUBMISSION_DOMAINS);
    if (
      !configured ||
      typeof configured !== 'object' ||
      Array.isArray(configured)
    )
      return {};
    return Object.fromEntries(
      Object.entries(configured).filter(
        ([, domain]) =>
          typeof domain === 'string' &&
          /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)
      )
    );
  } catch {
    return {};
  }
}

export function submissionSiteForRecipient(
  email: string,
  env = mailBindings()
) {
  const matches = Object.entries(submissionDomains(env)).filter(
    ([, domain]) => email === `submit@${domain}`
  );
  return matches.length === 1 ? matches[0][0] : null;
}

export function directSubmissionEmailOf(
  site: { id: string; url: string },
  env = mailBindings()
) {
  try {
    const domain = new URL(site.url).hostname.replace(/^www\./, '');
    const email = `submit@${domain}`;
    return submissionSiteForRecipient(email, env) === site.id ? email : null;
  } catch {
    return null;
  }
}
