#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for mdbmap: pinned Bun toolchain, project
# dependencies, generated Cloudflare + GraphQL types, and shared agent skills.
set -euo pipefail

cd "$(dirname "$0")/.."

# package.json devEngines pins Bun 1.4.0. Install it if the base image does not
# already provide it; Bun persists under $HOME/.bun in the snapshot.
if ! command -v bun >/dev/null 2>&1; then
	curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.0"
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

bun install --frozen-lockfile

# worker-configuration.d.ts is gitignored and generated from wrangler.jsonc.
bun run cf-typegen

# src/generated/gql is generated from schemas/schema.graphql.
bun run codegen

# Install Matt Pocock's agent skills (github.com/mattpocock/skills) into the VM's
# user-level skills directory. ~/.agents/skills is a Cursor discovery path, so the
# Cloud Agent picks these up without committing them to the repo. Copied (not
# symlinked) so they survive in the environment snapshot. npm enforces this repo's
# bun devEngines, so use bunx. Non-fatal: a transient fetch failure must not break
# the core environment bootstrap.
mattpocock_skills=(
	ask-matt codebase-design domain-modeling grill-me grill-with-docs grilling
	handoff improve-codebase-architecture research resolving-merge-conflicts
	setup-matt-pocock-skills to-questionnaire to-spec to-tickets triage
	wayfinder wizard code-review
)
DO_NOT_TRACK=1 bunx skills add mattpocock/skills \
	--skill "${mattpocock_skills[@]}" \
	--agent cursor -g -y --copy ||
	echo "[install] warning: matt pocock skills install failed (continuing)"

# Install all skills from the private github.com/theacrat/skills repo. This needs
# the repo in the environment's GitHub token scope: it is declared under
# repositoryDependencies in environment.json AND the Cursor GitHub App must be
# granted access to theacrat/skills. The skills CLI clones over git, so the
# environment's url.insteadOf token rewrite authenticates the clone. Non-fatal so
# a missing grant or transient failure does not break the core bootstrap.
DO_NOT_TRACK=1 bunx skills add theacrat/skills \
	--skill '*' --agent cursor -g -y --copy ||
	echo "[install] warning: theacrat/skills install failed (continuing; check Cursor GitHub App access + repositoryDependencies)"
