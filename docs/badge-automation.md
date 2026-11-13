# Automatic badge installation

Backlora installs an official directory badge through a dedicated site endpoint,
then checks the anonymous public HTML before the agent resumes directory submission.
No administrator browser session is needed after the one-time connection.

## One-time activation

1. Deploy the site changes including `POST /api/integrations/footer-badges`.
2. Generate a different credential for each site, saving it outside the repository:

   ```sh
   node scripts/create-badge-credential.mjs --output /absolute/private/directory/site-badge.json
   ```

   The command refuses to overwrite files, creates mode `0600`, and never prints
   the credential. Set the site's server environment `FOOTER_BADGE_AUTOMATION_TOKEN_HASH`
   to the file's hash field. Never deploy the plaintext `token` to the site or expose
   either value through a `VITE_` variable. The site's `VITE_APP_URL` must use its
   canonical HTTPS origin, matching the website URL registered in Backlora.

3. On Backlora, configure `CONFIG_ENCRYPTION_KEY` and set the server environment
   `BACKLINK_BADGE_ALLOWED_HOSTS` to the exact comma-separated hostnames being connected.
   No wildcard, URL scheme, port or path. An empty allowlist disables the bridge.
4. In the new-website wizard's last step or the owned website's edit page, use
   **Automatic badge installation** to enter
   the file's `token` once. Backlora checks the site's capability and saves the
   credential encrypted with its destination. API agents can read readiness but
   cannot retrieve, change or disconnect the secret.
   A successful connection requeues this website's unfinished reciprocal-link
   blockers automatically. Other failure reasons, active leases and completed
   submissions are left alone. Prior evidence and review URLs remain attached,
   so the agent checks existing listings and resumes drafts before submitting.
5. Recopy the generated agent prompt into existing scheduled runs. Old prompt
   copies do not update themselves. Keep credential files in private storage or
   delete them after secure provisioning; never include them in logs or a commit.

No schema migration is needed. The existing encrypted config store is used.

## Future projects

The bridge and generated agent instructions work for every website ID; they are
not hard-coded to the original 21 projects. A newly registered website does not
automatically gain a site endpoint, server credential, allowed destination,
mail-forwarding rule, mailbox session or scheduled job. Complete the one-time
activation above, save that project's email/password/mailbox, and activate its
runner. New prompt copies include the email and badge workflow automatically;
existing copied schedules retain their own prompts until explicitly updated.
Once connected, each badge is saved as website data, without editing source or
deploying again. Third-party identity checks and directory acceptance still
depend on the target site.

## Agent flow

New projects use the same instruction composer as existing projects. The final
copied instructions always include the current badge capture procedure in their
API contract, even if the primary prompt was edited or replaced. The standalone
`/skill/codex.md` endpoint includes it too. Existing scheduled jobs retain their
copied instructions until updated. Verify these paths with
`pnpm test:agent-instructions`.

- Read official badge HTML from its code field or `data-clipboard-text` first.
  Never call browser or system clipboard-read APIs. For a Copy-only button,
  import `/agent/badge-embed.mjs` from Backlora in the agent's Node context, then
  run `page.evaluate(captureBadgeEmbed, { buttonText: '<observed button label>' })`.
  The helper captures the selected button's outgoing text without calling the
  native clipboard and restores the method on success/error/timeout. It does
  not grant permissions or submit the form. Use `embed.html` unchanged with the
  badge API. Already handed-off pages still require the user to return control.
- CLI HTTP requests should identify themselves with `User-Agent: Backlora-Agent/1.0`
  and `Accept: application/json`. The live edge rejects Python urllib's default
  User-Agent with HTTP 403 / `error code: 1010`; that response is not an API-key
  validation failure. Browser requests retain their browser User-Agent.
- Read `GET /api/websites/{website_id}/badge-connection` with the Backlora API key.
- When `ready=true`, send the original official HTML to
  `POST /api/v1/backlink-tasks/{task_id}/badge` with `worker_id`, `lease_id`, `html`.
  Only the owner and the active, unexpired task lease can install. The agent sends
  its Backlora API key only to Backlora; the site credential never enters its prompt.
- `installed=true, publicly_verified=true` means the badge exists in anonymous HTML.
  The agent still must return to the directory, run its verification and submit.
  This response does not mean the directory submission succeeded.
- `saved_not_public` means saved but not visible/verified. Inspect the public page,
  caching and footer rendering. Retry the same task, lease and HTML with
  `verify_only: true` to check without writing or transmitting a site credential.
  Limit rechecks to two within 30 seconds; `not_public` means it is still absent.
  Do not keep appending copies. Retrying an uncertain
  save with the same href updates the same badge and preserves other badges.
- Errors identify `data.stage`: task, configuration, credential, markup, connection,
  response or save. Report that concrete blocker. An unsupported snippet or missing
  login is not a reason to hand the whole installation procedure to the user.

Browser installation remains available for websites without this connection.
Only one HTTPS anchor with text and/or one image plus supported inert metadata is
accepted. Scripts and interactive embeds need a different integration.

## Revocation and destination changes

Disconnecting removes Backlora's saved credential immediately. To revoke a leaked
credential at the site, replace or clear `FOOTER_BADGE_AUTOMATION_TOKEN_HASH` in its
runtime environment; reconnect with a newly generated token when replacing it.
Changing the registered website origin requires reconnecting. Redirects never
receive the credential. Existing badges remain when a connection is removed.

## Verification

Run `pnpm test:badge-bridge`, `pnpm test:badge-bridge:d1`, `pnpm test:backlinks`,
`pnpm test:admin`, `pnpm build` and `pnpm cf:build` in Backlora. In each site run
`pnpm test:footer-badges`, `pnpm test:footer-badges:d1`, `pnpm build` and
`pnpm cf:build`. All database tests use isolated temporary databases.
