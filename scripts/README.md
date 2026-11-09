# Operational scripts

This folder will hold the admin-without-a-portal tooling described in
`OverflowGo_MD_Docs/03_ARCHITECTURE.md`:

- `seed-localities` — load localities (name + center lat/lng) from CSV.
- `seed-drivers` — create drivers and their ordered regular routes.
- `export-payouts` — CSV of verified rewards for a date range.

Planned for Phase 2 (seeds) and Phase 3 (payouts). AI-service helper scripts
live in `apps/ai-service/scripts/`.
