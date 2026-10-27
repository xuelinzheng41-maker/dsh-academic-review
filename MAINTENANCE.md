# Maintenance — dsh-academic-review

## Upstream sync policy

- **Cadence**: check the upstream repository
  (https://github.com/Imbad0202/academic-research-skills) roughly every
  **6 weeks** for a new minor release of the `academic-paper-reviewer` skill;
  sync minor releases on that cadence. Patch releases with security or
  correctness fixes may be synced out of band.
- **Pin, never float**: the vendored tree is pinned by
  `vendor-manifest.json` (`upstream.commit`, per-file SHA-256). The manifest
  is the single source of truth for what is vendored; nothing in `vendor/` may
  drift from it.
- **Sync procedure**:
  1. Read the upstream changelog/diff for the new commit; assess whether
     behavior changes touch the port spec (`docs/PORT_SPEC.md`) or seat
     protocols (`docs/SEAT_PROTOCOLS.md`).
  2. Re-vendor: `pnpm vendor -- --upstream <path to ARS checkout at the new
     commit>`. This rewrites `vendor/` and updates `vendor-manifest.json`
     atomically; vendored files are never hand-edited.
  3. Update the pinned commit in this document,
     `THIRD_PARTY_NOTICES.md`, and `README.md`.
  4. Re-run the full gate: `pnpm typecheck && pnpm test && pnpm build &&
     pnpm verify:vendor`.
  5. If upstream changed prompts/agents/templates, reconcile
     `assets/prompts/` and the docs, and bump the plugin minor version.
- **Non-goals**: upstream areas this port does not serve
  (`academic-pipeline`, `sr-screener`, the upstream pipeline scripts) are not
  vendored; revisit only when those skills are added. `deep-research` and
  `academic-paper` **are** vendored and served, prompt-only (no tool, no state,
  no panel).

## Named maintainer

- **Maintainer of record**: release-engineer (the AgentTeams
  `release-engineer` member who owns the release surface). Per-project
  contact point: open a GitHub issue; no private channel is provided.

## Release checklist

1. `pnpm verify:vendor` — vendored bytes match the manifest commit.
2. `pnpm typecheck && pnpm test && pnpm build` — all green.
3. `LICENSE`, `THIRD_PARTY_NOTICES.md`, README attribution — pinned commit
   and version are current.
4. `pnpm pack` — `files` in `package.json` is the contract: `lib`, `vendor`,
   `vendor-manifest.json`, `cordis.patch.yml`, `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`,
   `docs`, `assets`. Every user-facing document ships in the tarball, and the
   two READMEs ship together.
5. Tag the release with the upstream commit it vendors, e.g.
   `v0.1.0+ars.1ec249d`.
