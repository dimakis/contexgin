# Knowledge publication

ContexGin owns the generic publisher. Mitzo owns its sandbox bundles and session
adoption. Centaur owns review. The publisher does not require Centaur to run.

## Flow

1. An agent commits knowledge on a feature branch. It remains local until pushed.
2. Reviewed changes reach the configured accepted Git ref, usually `refs/heads/main`.
3. GitHub sends a signed push webhook. ContexGin validates the exact body, repository,
   ref, and delivery id, commits the work to SQLite, and returns HTTP 202.
4. The worker fetches the configured ref into its private bare mirror. State children cannot redirect writes through symlinks. Each acquisition owns a private Git ref, so overlapping workers cannot change its
   selected revision. Payload SHAs never select the revision. Duplicate deliveries are ignored; bursts coalesce.
5. Explicit portable `.md` paths are copied from Git blobs into private staging.
   Repository scripts and hooks are never run. Symlinks/submodules at selected Markdown
   paths fail validation. Non-Markdown assets in directory selections are omitted.
6. The existing compiler creates boot context. A manifest records the accepted ref and a digest of source configuration, and hashes
   every source file and the compiled context. Data and directories are flushed before an atomic directory
   rename, then a fenced SQLite transaction promotes the current pointer.
7. A consumer verifies the manifest and copies/mounts the snapshot read-only. It applies
   its own runtime compatibility checks and records the revision adopted by the session.

Only accepted Git content is shared. Dirty worktrees, agent branches, and writable
session files are never pulled, reset, rebased, or rewritten by this service.

## Configuration

Pass `--publication-config /absolute/path/publication.json` to `contexgin serve [root]`:
workspace roots are optional for a standalone publisher. No local source checkout is needed.

```json
{
  "root": "/absolute/private/contexgin-publications",
  "webhookSecretEnv": "CONTEXGIN_GITHUB_WEBHOOK_SECRET",
  "readTokenEnv": "CONTEXGIN_PUBLICATION_READ_TOKEN",
  "sources": [
    {
      "id": "my-notes",
      "url": "https://github.com/example/my-notes.git",
      "ref": "refs/heads/main",
      "githubRepository": "example/my-notes",
      "paths": ["AGENTS.md", "KNOWLEDGE.md", "memory/"],
      "optionalPaths": ["CLAUDE.md", "CONSTITUTION.md", "context/"],
      "excludePaths": ["memory/scripts/", "memory/manifest/"],
      "excludePathSegments": ["node_modules"],
      "excludeHiddenPaths": true
    }
  ]
}
```

The root must be owned by the service user, mode 0700, and disjoint from user workspaces.
The daemon protects all configured workspace roots and local Git source paths, resolves
parent symlinks before creating state, and rejects Git checkout ancestors. Embedded
clients must supply `workspaceRoots` for their additional non-Git workspaces.
Environment variables supply secrets; never commit them. Git uses the service user's
credential helper, not URL-embedded credentials. Changing a source URL/ref/path policy
invalidates the old current pointer and queues a fresh publication. Stop the previous
service before changing configuration; worker leases fence overlapping restarts.

`paths`, `optionalPaths` and `excludePaths` contain literal file names or directory prefixes
ending in `/`; they are not globs. Exclusions take precedence and are applied before
reading Git blobs or compiling context. Missing exclusion targets are allowed.
`excludeHiddenPaths: true` excludes a file whenever any path segment begins with `.`.
Directory selections discover newly accepted Markdown and omit deleted files without
changing the policy.
Required `paths` must be nonempty, and each required selection must contain eligible
Markdown. `optionalPaths` use the same selection rules, but may be absent or empty:
new optional instructions and context directories are discovered after acceptance,
and deleting optional guidance does not block publication. List anticipated root/spoke
guidance files and context directory prefixes here instead of freezing their current file list.
`excludePathSegments` excludes exact nonempty single path-segment names at any depth,
for example `memory/category/node_modules/private.md`; slashes, backslashes, `.` and
`..` are invalid segment names. Exclusion rules apply to required and optional selections.
Exclusions must use safe relative paths, and the hidden-path setting must be boolean.
All optional settings are bound into source identity and the snapshot manifest.
Omitting them retains the existing source identity and manifest format; explicit empty
exclusions or `false` are still configuration changes and invalidate prior cache state.
Snapshot reuse independently checks these settings and every file's selection policy,
even when a corrupted manifest and its hashes are internally consistent.

Configure GitHub's `push` webhook to reach `/api/publications/github` with the matching
secret and JSON content type. Expose only that route through the existing authenticated
TLS ingress. No webhook or launchd installation is performed by enabling the code alone.

The reviewed [Nginx webhook ingress example](deployment/knowledge-webhook-nginx.conf)
forwards only exact POST request targets to loopback receivers: `/webhook` to an
optional Centaur receiver on port 8642 and `/api/publications/github` to ContexGin on
port 8643. It rejects all other paths, query strings and normalized/encoded aliases,
limits bodies to 1 MiB, strips Authorization, and logs neither bodies nor signature
headers. Runtime error logs are discarded to `/dev/null` because even error-level
diagnostics can include rejected request targets, query secrets or headers. Access
logs contain only fixed route labels, status codes and durations. This trades detailed
per-request diagnostics for secret-safe observability; monitor status/rate metrics and
keep startup `nginx -t` evidence separately. Do not replace the discard policy by
raising the log threshold. Remove the optional Centaur location and whitelist entry when unused.
Receiver-side signature verification remains mandatory. Keep read, reconcile and
retry APIs on the host; do not forward them through public ingress.

Provision Nginx from a trusted package source. Use a private prefix outside workspaces,
create its `logs`, `tmp/body` and `tmp/proxy` directories, and check the configured
example with `nginx -p /absolute/private/ingress/ -c /absolute/config/nginx.conf -t`
before starting it. The loopback listener expects a separately configured authenticated
TLS ingress. Test valid signatures, rejected methods/paths, body limits and log contents
against local fixture receivers before activation. This example contains no secrets,
personal paths or service installation instructions.

Run the offline ingress regression with `python3 tests/deployment/knowledge-webhook-nginx.py`
(`--nginx /absolute/path/nginx` when needed). It uses disposable loopback receivers,
checks oversized requests with query/header secrets and unavailable upstreams, and
asserts access logs, error logs and runtime stderr contain no test secrets. It does
not contact real receivers or activate ingress.

The optional read token enables these local consumer APIs:

- `GET /api/publications/:source`: current snapshot location, revision, manifest digest,
  queue progress and error state.
- `POST /api/publications/:source/reconcile`: enqueue and wait for reconciliation. HTTP
  503 means fresh knowledge is unavailable; a new session must retry or surface the error.
  Admission checks enqueue work without bypassing failure backoff.
- `POST /api/publications/:source/retry`: explicit operator retry, eligible only after
  one minute since the last failed attempt; otherwise HTTP 429.

All three require `Authorization: Bearer <read-token>`. Consumers on the same host can access
published files through the returned directory. This version does not provide remote
snapshot downloads. Never give the read token to repository agents or expose these
routes publicly. The library also exports `KnowledgePublisher` for embedded clients.

## Recovery and retention

The service queues recovery at startup and every 30 minutes. A cheap 30-second local
queue check handles retries; it does not fetch unchanged repositories every 30 seconds.
Failures retry with backoff from one minute to 30 minutes, preserving the last publication.
A crashed worker's lease expires within five minutes. New deliveries wake the worker
immediately when eligible under backoff. Repeated admissions and recovery do not
clear the retry deadline. Fencing prevents an expired worker from promoting stale work.

SQLite uses WAL and FULL synchronization. Snapshot files and directory entries are
flushed before promotion. Unchanged revisions reuse snapshots only after checking the complete file set, all
hashes, source identity and recompiling with the running compiler; corruption triggers a fresh build.
Old and orphan snapshots remain available for active consumers. Automatic GC requires
consumer pin/adoption receipts and is intentionally deferred; monitor private state size.

## Format and rollout

The manifest format is `contexgin-portable-v1`. The snapshot contains `source/`,
`manifest.json`, and `context.json`. Compiler discovery determines the boot context;
all selected Markdown remains available for later scoped compilation and retrieval.
A portable directory does not itself prove compatibility with a consumer's runtime.

Mitzo's existing MGMT bundle format additionally attests compiler, recipe, schema,
frozen runtime inputs, and a runtime baseline. **Do not feed portable-v1 directly into
that consumer or bypass its attestations.** The Mitzo bridge must build that compatible
bundle from the published accepted revision, preserve revision/manifest provenance,
then deliver at safe turn boundaries. Session admission must call reconciliation, and
provider adoption receipts must record success before claiming delivery to every session.

The legacy `/api/knowledge-space/rebuild` route remains separate. It pulls a local MGMT
checkout and invokes crawl/embed scripts; generic publication never invokes that route.
Future backends can implement source acquisition behind the same revision/snapshot
contract. This implementation supports configured Git stores only.
