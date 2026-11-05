# Badge automation rollout — 2026-11-05

## Current state

The site-side integration is deployed and authenticated on all 21 enabled
Backlora websites. Backlora's bridge, destination allowlist, and recovery of
unfinished reciprocal-link blockers are deployed. **All 21 deployed websites
are now connected through the authenticated owner-session API.** Each returned
`configured=true` and `ready=true`. Connection recovered 102 unfinished
reciprocal-link blockers as pending tasks, including 11 for PosterSize.
This does not mean an external directory accepted a submission.

| Website              | Site endpoint | Backlora connection |
| -------------------- | ------------- | ------------------- |
| CADCraft             | Verified      | Connected           |
| Firefly Wedding      | Verified      | Connected           |
| HackerTube AI        | Verified      | Connected           |
| Hotel Lobby AI       | Verified      | Connected           |
| Ideogram 4.5         | Verified      | Connected           |
| PDFCraft             | Verified      | Connected           |
| PavoAI               | Verified      | Connected           |
| Qwen Image 2.1       | Verified      | Connected           |
| Raindance AI         | Verified      | Connected           |
| Rumpelstiltskin AI   | Verified      | Connected           |
| SciDrawer AI         | Verified      | Connected           |
| Uncensored AI        | Verified      | Connected           |
| Vikas Editor AI      | Verified      | Connected           |
| WordCraft            | Verified      | Connected           |
| ZombieTrend AI       | Verified      | Connected           |
| kimik3               | Verified      | Connected           |
| metalfontgeneratorai | Verified      | Connected           |
| nanobanana 2.1       | Verified      | Connected           |
| opus55video          | Verified      | Connected           |
| postersize ai        | Verified      | Connected           |
| viddir               | Verified      | Connected           |

SciDrawer is served by Vercel. Its local Cloudflare configuration does not
identify an existing Cloudflare Worker. The old Vercel access token returned
403, but Vercel CLI successfully refreshed the existing login. Deployment now
used its original `scidrawer` project and is complete; no hosting migration was
involved. The badge audience now uses its canonical public origin, avoiding the
existing difference between `scidrawer.com` and `www.scidrawer.com`. A deployment
input audit also found local env backups and a development database in the CLI
upload list; `.vercelignore` now excludes them, and a dry run verified exclusion
before any upload.

## Repairs and verification

- Added the scoped installation endpoint, hashed credential authentication,
  HTML validation, idempotent merging, and public HTML rendering to the 13 sites
  missing the integration. All thirteen are now deployed.
- Preserved legacy text-only badges on CADCraft, HackerTube, PavoAI and Vikas.
- Connected Uncensored AI's actual homepage footer to the saved badge list.
- Removed PavoAI's homepage prerendering that froze the saved badge list.
- Corrected Raindance's production origin configuration.
- All 13 source integrations passed their integration tests, local D1 tests and
  production builds. The four legacy-text compatibility sites passed 18
  integration tests; the other nine passed 17. Each passed 7 local D1 tests.
- Backlora's recovery change passed 13 SQLite and 13 local D1 tests, TypeScript,
  production build, security scan and deployment.
- Twelve sites with existing badges passed a live repeat-save and anonymous
  HTML check. Their badge counts stayed unchanged and all previous links remained
  visible: CADCraft 98, Hotel 24, Ideogram 113, Pavo 127, Qwen 39, Raindance 31,
  Rumpelstiltskin 114, Uncensored 21, ZombieTrend 68, kimik3 5, nanobanana 132,
  opus55video 41.
- PosterSize and SciDrawer's official DoKeyAI partner link was installed and verified in
  anonymous homepage HTML. Requirement source:
  <https://dokeyai.com/submit>. No external directory submission or acceptance
  was asserted by this check.

## Existing scheduled jobs

Updated the eight active Backlora job prompts: viddir, nanobanana 2.1,
Qwen Image 2.1, postersize ai, Ideogram 4.5, SciDrawer AI, ZombieTrend AI,
and metalfontgeneratorai. Readback confirmed the new prompts and preservation
of their schedules, models, status, destinations and notification settings.

The jobs now preflight the badge connection, use the leased task badge API,
check anonymous HTML, return to the directory for verification, and retain
prior submission evidence when retrying. They continue to use each product's
configured email and registration password, and its configured mailbox for
verification. Unrelated Submify jobs were not migrated.

All 21 saved connections were verified as encrypted at rest. All 21 connections
returned `ready=true` to an authorized agent API credential, including the eight
projects with existing Backlora jobs.

A production probe also confirmed that Python urllib's default User-Agent gets
403 / `error code: 1010`, while the same API credential with an explicit agent
User-Agent gets 200. Updated the generated prompt and all eight existing jobs
to identify CLI requests as `Backlora-Agent/1.0`; browser requests retain their
normal User-Agent. The updated Backlora prompt build and deployment passed.

The configured Gmail session is accessible, and its recipient search returned
mail addressed to `support@postersize.org`.

All 21 enabled projects have product email and registration password settings.
This inventory does not verify every external account password or email
forwarding route. A missing mailbox session, incompatible Google-only login,
or interactive identity challenge must still be reported accurately.

## Completion and limits

All 21 websites are deployed and connected. Recovery returned 102 tasks to the
pending queue: PosterSize 11, Firefly Wedding 2, Ideogram 17, Qwen 7, Raindance 6,
Rumpelstiltskin 11, Uncensored 2, ZombieTrend 1, kimik3 4, metalfontgeneratorai 4,
nanobanana 17, opus55video 13, viddir 3, SciDrawer 4. The other projects had no
eligible reciprocal blockers to recover.

The updated jobs continue under their existing schedules. Their directory
verification and submissions still require actual evidence from the target
sites; this rollout does not mark those 102 tasks as submitted or accepted.
Existing pending-review submissions must not be sent again. Future badge
installation writes website database settings and needs no source edit or
redeployment.

Initial completed Backlora rollout: `768860b7-0e4c-4d79-afa1-cea1d7c36f8e`.
Latest Backlora Worker version: `17966219-f90a-49b0-96db-960fe9c54684`
(task-claim repair and new-project connection entry below).
Final SciDrawer Vercel deployment: `dpl_381yNgU8F1psa55DaxN7o6jeW4Go`.
SciDrawer's final source passed 17 integration tests and production build;
its live endpoint successfully saved the official required link and anonymous
HTML verification passed. All browser task pages were closed after completion.

No production schema migration, admin privilege escalation, or replacement of
authentication/encryption secrets was performed. Dedicated badge credentials
are held in private storage outside the repositories and must never be copied
into this report, agent prompts or logs.

## Follow-up: every registered project

The owner requested coverage of every website listed in Backlora and chose to
keep the existing jobs while filling missing projects. The live list contains
21 enabled projects. All 21 task payloads returned an available registration
password (only availability was recorded), and all 21 badge connections are ready.

Cloudflare API inspection verified that all 20 custom-domain product mailboxes
have active forwarding rules to the configured, verified Gmail destination.
SciDrawer uses a separate Gmail identity: its mailbox-management URL previously
pointed at the shared account and has now been corrected to the product account.
The intended account is signed in and contains relevant directory mail. Its two
email-verification blockers were requeued, retaining evidence. No external
password or Google identity was changed.

Kept the eight existing Backlora jobs and added nine active jobs, every two
hours with staggered minutes and at most ten tasks per batch. The owner then approved switching the four overlapping products from Submify.
Their old schedules were paused first; the latest old runs were confirmed
completed, including Vikas's final batch, before activating the four prepared
Backlora jobs. All 21 projects now have one active Backlora job. The four migrated
jobs retain their schedules and model settings, and explicitly check prior
listings, receipts and drafts even when a Backlora record is pending. Other
Submify jobs were not changed.

| Project              | Backlora job | Mail and badge readiness |
| -------------------- | ------------ | ------------------------ |
| CADCraft             | Active       | Verified                 |
| Firefly Wedding      | Active       | Verified                 |
| HackerTube AI        | Active       | Verified                 |
| Hotel Lobby AI       | Active       | Verified                 |
| Ideogram 4.5         | Active       | Verified                 |
| PDFCraft             | Active       | Verified                 |
| PavoAI               | Active       | Verified                 |
| Qwen Image 2.1       | Active       | Verified                 |
| Raindance AI         | Active       | Verified                 |
| Rumpelstiltskin AI   | Active       | Verified                 |
| SciDrawer AI         | Active       | Verified                 |
| Uncensored AI        | Active       | Verified                 |
| Vikas Editor AI      | Active       | Verified                 |
| WordCraft            | Active       | Verified                 |
| ZombieTrend AI       | Active       | Verified                 |
| kimik3               | Active       | Verified                 |
| metalfontgeneratorai | Active       | Verified                 |
| nanobanana 2.1       | Active       | Verified                 |
| opus55video          | Active       | Verified                 |
| postersize ai        | Active       | Verified                 |
| viddir               | Active       | Verified                 |

These checks establish configuration and access, not successful login to every
third-party site. Jobs must still verify actual email codes, target eligibility,
submission receipts and public links. Local scheduled jobs require the desktop
app and computer to remain running; see the [official scheduling documentation](https://learn.chatgpt.com/docs/automations).

Final schedule readback: 21 active Backlora jobs for 21 distinct website IDs,
with mailbox and badge instructions present in every job; all four superseded
Submify schedules are paused. Historical Submify records were not deleted or
marked as successfully submitted by the scheduling change.

## Follow-up: live task claiming and future projects

New scheduled runs exposed a separate `/start` timeout/500 before any external
submission. A live replay returned 500 after 36.65 seconds. Worker logs identified
the candidate-selection query; D1 also reported its CPU limit and reset. The
paid-history exclusion was correlated with every candidate, repeatedly scanning
the owner's history. Production held 36,672 records at diagnosis.

Replaced that scan with one user-scoped paid-target exclusion set. The existing
NOT NULL target URL constraint preserves the semantics. No schema, ownership,
paid-submission authorization or lease rules changed. Read-only production query
plans confirmed the exclusion is now uncorrelated; the full candidate query
completed in 36.31 ms with 45,874 rows read.

Task tests passed 19/19 on SQLite and 19/19 on local D1, including same-worker
concurrency and manual/catalog paid exclusions. TypeScript, formatting, production
build and Cloudflare deployment passed. Live API probes then verified start,
same-worker retry, heartbeat, task read and password availability on PosterSize
(2.411 s), Nano Banana (2.714 s) and CADCraft (2.908 s). Only these test leases were
conditionally restored to their prior pending state and attempt counts. No
external submissions or false success results were generated. The public home
page and public-config endpoint returned 200 in the deployment smoke check.

New website creation now presents the existing badge-connection control before
the generated agent instructions. The common backend and prompt generator work
for future website IDs, but creating a profile is not provisioning: each new
site still needs its deployed endpoint, dedicated credential, allowed destination,
mailbox configuration/access, and activated scheduled runner. Once connected,
future badges are database writes, with no per-badge code changes or deployment.
These checks do not establish successful login or acceptance at every directory,
nor completion of a full external batch for all 21 projects.
