# Operational scripts

This folder holds the admin-without-a-portal tooling described in
`OverflowGo_MD_Docs/03_ARCHITECTURE.md`.

## Seed localities

```bash
npm run db:migrate
npm run seed:localities
# or with a real city file
npm run seed:localities -- --file scripts/data/locality-areas.csv
# preview without writing
npm run seed:localities -- --dry-run
```

CSV format:

```csv
# name,lat,lng
Area A,18.5160,73.8410
```

Re-running updates existing names in place, so the same script can load the
real city areas later. The committed sample file uses fake coordinates.

## Planned

- `seed-drivers` — create drivers and their ordered regular routes (Phase 2).
- `export-payouts` — CSV of verified rewards for a date range (Phase 3).
