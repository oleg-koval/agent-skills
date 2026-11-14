---
name: 1password-agent-access
description: Set up scoped 1Password access for coding agents, copy approved credentials into an agent vault, or organize a personal vault with reversible tags. Use for repeated CLI approval prompts and agent credential setup; ordinary secret reads use the configured launcher.
license: MIT
metadata:
  author: Oleg Koval
  tags: [1password, agents, credentials, security]
---

# 1Password Agent Access

Give local coding agents access to an explicitly selected set of credentials,
without repeated desktop authorization. Also support metadata audits and
reversible vault organization. Select only the modes the user requested.

## Scope and prerequisites

- Discover the installed `op` version and connected accounts. Resolve the exact
  source account before reading items; never include a work account merely
  because it is connected. Reuse authorization and scope already established.
- Inventory metadata first: IDs, titles, categories, tags and timestamps. Parse
  website domains locally if needed; never print raw URLs, query strings or
  fragments because saved login URLs can contain tokens.
- Before copying, state the destination and access granted. A request to audit
  or recommend is not permission to copy. A request to organize is not permission
  to delete, merge, rename items or change access.
- Never log secret values, subprocess stdout containing items, session tokens or
  service-account tokens. Capture sensitive output in memory. Avoid shell tracing,
  command-line secret arguments, shell history and plaintext token files.

## Set up agent access

1. Check current official documentation and `op --help` for supported account,
   vault and service-account operations. Desktop CLI approval is session-bound;
   service-account authentication is the unattended alternative.
2. Reuse an appropriate agent vault or create a dedicated one in the selected
   account. Built-in Personal/Private/Employee and default Shared vaults cannot
   be granted to service accounts. Do not move original items to work around this.
3. Create a service account with read-only item access to the approved vault.
   Do not grant vault creation, sharing or write permissions unless needed and
   authorized. Creation returns the token only once: route it directly into a
   supported secure credential store and verify retrieval without displaying it.
   If storage fails, report the created account and recovery/revocation work;
   do not silently create more tokens.
4. Install a local launcher that retrieves the token from the credential store,
   exports `OP_SERVICE_ACCOUNT_TOKEN` only to its child process and executes the
   real CLI by absolute path. On macOS use Keychain; avoid exposing the token in
   process arguments. Inspect existing launchers before replacing anything.
5. Optionally install a coding-agent launcher that passes the same environment
   to the agent process. Verify the credential store can be read in that launch
   context; it can have its own authorization prompt. Do not promise zero prompts
   until a token-authenticated CLI read succeeds.
6. Verify the account identity and exact accessible vault set through the launcher.
   Verify an approved secret by injecting it into a child command and reporting
   presence only, without showing its value.
7. Update the requested agents' active instruction sources to use the launcher
   and explicit destination vault references. Never hand-edit generated contract
   files. Avoid replacing unrelated configuration. Tell agents not to fall back
   to desktop `op signin`, personal/work vault reads or interactive MCP calls when
   a secret is missing; report the missing item once. Existing sessions may need
   restarting to load instructions or environment variables.

### Environments are separate

Use the available 1Password Environments connector/skill for Environment
inventory and configuration; names-only tools avoid exposing values. Vault
access does not imply Environment access. Current documentation requires the
web creation wizard for a service account with Environment access, and existing
service-account grants are immutable. If supported tooling cannot complete that
flow, report it blocked rather than claiming the vault token covers it.
Never use private APIs or browser session extraction to bypass the limitation.

## Audit and copy approved credentials

1. Produce candidates from metadata. Prefer project-scoped API credentials over
   broad account logins. Titles cannot prove permissions, validity, spending
   limits or ownership; mark these unknown unless independently checked.
2. Keep recovery identities, root keys, backup encryption keys, primary email,
   financial accounts and identity documents outside routine agent access unless
   specifically authorized. Read-only vault access still lets an agent use a
   copied credential with all of that credential's original provider permissions.
3. Freeze the approved selection as source item IDs and destination vault ID.
   For date-based selection, use `created_at` in the user's timezone, not the
   modification timestamp. Do not rerun a broad selector during a resumed batch.
4. Copy rather than move. Preserve supported fields, sections, notes, tags and
   URLs without printing them. Check attachments, passkeys and special item
   types first: a JSON round-trip is not proof of a complete copy. Unsupported
   content stays untouched and is reported, not silently omitted.
5. Use a provenance marker or local ID mapping to make retries idempotent.
   Store account/item-specific receipts locally with restrictive permissions,
   never in the public skill repository. Skip verified existing copies; do not
   overwrite a diverged copy without resolving the difference.
6. Re-read each copy. Verify field types and section/label relationships along
   with values in memory, allowing regenerated IDs and documented empty-field
   defaults. Also verify notes, tags and URLs. A matching bag of values alone
   can miss a value assigned to the wrong field. Report only counts/status.
7. Stop on a content mismatch. Diagnose the exact discrepancy without exposing
   values; never progressively weaken verification until the batch passes.

## Organize a personal vault without breaking references

1. Inventory metadata and save a local rollback manifest of original IDs, titles,
   vault IDs and tags. Store no secret values in the manifest. Preserve the first
   baseline across resumes, plus a separate progress journal.
2. Propose a small additive tag taxonomy, for example `Organized/Developer`,
   `Organized/Finance` and `Review/Same title`. Avoid tagging every login with a
   redundant generic label. Preserve existing tags, names, IDs and vault locations.
3. Same-title groups are review candidates, not proven duplicates. Do not merge,
   archive or delete them automatically. Do not rename items referenced by `op://`
   paths. Editing a source does not automatically synchronize agent copies.
4. Use tag-only CLI flags, not item JSON templates: JSON edits can overwrite
   passkeys. Read current tags immediately before each write and preserve their
   union with the planned additions. Handle comma-containing tags explicitly;
   never split or corrupt them through a comma-delimited argument.
5. Run writes sequentially. Concurrent writes produced HTTP 409 conflicts in the
   observed workflow. Stop on an unexpected error. Known unsupported `ssoLogin`
   fields and SSH-key editing must be skipped when the installed CLI rejects
   them; do not reconstruct the item to force an edit.
6. Set a finite item budget from the frozen plan. On failure, terminate pending
   work before resuming; an executor may otherwise drain queued writes after its
   first exception. Resume only unfinished IDs and avoid repeated identical errors.
7. Re-read the authoritative inventory. Assert all original IDs, titles, vault
   locations and original tags remain, and every successful addition is present.
   Keep the rollback manifest and report modified, skipped and failed counts.

## Handoff

Report separately: account scope, copied items, organization changes, token
storage, launcher verification, agent instruction activation and Environment
access. Name unknown provider permissions and spending limits explicitly. Never
claim organization removed duplicates, token setup proves all agents adopted it,
or instructions guarantee a prompt-free existing session.

## Sources

- [CLI authorization model](https://www.1password.dev/cli/app-integration-security)
- [Service-account setup and limitations](https://www.1password.dev/service-accounts/get-started)
- [CLI item editing](https://www.1password.dev/cli/reference/management-commands/item/#item-edit)
