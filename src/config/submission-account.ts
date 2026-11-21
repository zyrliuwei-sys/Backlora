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
  BACKLORA_PAVO_GOOGLE_EMAIL?: string;
  VERIFICATION_MAIL?: VerificationMailbox;
};

export function mailBindings(): MailBindings {
  return (globalThis as { __CF_ENV__?: MailBindings }).__CF_ENV__ ?? {};
}

export function directMailEnabled(
  site: { id: string; url: string },
  env = mailBindings()
) {
  if (!env.VERIFICATION_MAIL || site.id !== env.BACKLORA_MAIL_WEBSITE_ID)
    return false;
  try {
    return ['pavoai.net', 'www.pavoai.net'].includes(
      new URL(site.url).hostname
    );
  } catch {
    return false;
  }
}

export function googleLoginEmailOf(site: { id: string; url: string }) {
  const env = mailBindings();
  if (!directMailEnabled(site, env)) return null;
  const email = env.BACKLORA_PAVO_GOOGLE_EMAIL?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
