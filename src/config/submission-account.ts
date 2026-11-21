/** Shared external-submission account for this Backlora installation.
 * Public contact emails always come from each website's own profile.
 */
export const DEFAULT_SUBMISSION_ACCOUNT = {
  email: 'wldesign1983@gmail.com',
  capability: 'send_capable',
  mailboxUrl:
    'https://mail.google.com/mail/?authuser=wldesign1983%40gmail.com#inbox',
} as const;

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
