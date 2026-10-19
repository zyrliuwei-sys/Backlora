/**
 * Optional user-center pages an admin switches at Settings → Users → User
 * Features. Shared by the server (API routes refuse a feature that is off)
 * and the browser (nav entries, widgets), so both use the same default while
 * the setting has never been saved.
 */
export const USER_FEATURES = {
  credits_enabled: false,
  billing_enabled: false,
  payments_enabled: false,
  /** API Keys page. On: agents authenticate /api/agent/* with these keys. */
  apikeys_enabled: true,
  /** Support tickets: the page and the floating support button. */
  tickets_enabled: false,
} as const;

export type UserFeature = keyof typeof USER_FEATURES;

export function isUserFeatureOn(
  configs: Record<string, string | undefined> | undefined,
  feature: UserFeature
): boolean {
  const value = configs?.[feature];
  return value ? value === 'true' : USER_FEATURES[feature];
}
