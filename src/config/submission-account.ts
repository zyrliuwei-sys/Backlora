/** Shared external-submission account for this Backlora installation.
 * Public contact emails always come from each website's own profile.
 */
export const DEFAULT_SUBMISSION_ACCOUNT = {
  email: 'wldesign1983@gmail.com',
  capability: 'send_capable',
  mailboxUrl:
    'https://mail.google.com/mail/?authuser=wldesign1983%40gmail.com#inbox',
} as const;
