#!/usr/bin/env sh
set -eu

printf '%s\n' '== SportLeagues Agentic Framework preflight =='
for f in AGENTS.md PROJECT_CONFIG.md PROJECT_STATE.md README.md docs/product/PRD-MVP.md; do
  if [ -f "$f" ]; then
    printf '[OK] %s\n' "$f"
  else
    printf '[MISSING] %s\n' "$f"
    exit 1
  fi
done

printf 'MVP prompts: '
find prompts/mvp -maxdepth 1 -type f -name 'phase-*.md' | wc -l | tr -d ' '
printf '\nADRs: '
find docs/architecture/adr -maxdepth 1 -type f -name 'ADR-*.md' | wc -l | tr -d ' '
printf '\nPreflight complete.\n'
