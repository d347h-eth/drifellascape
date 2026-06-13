# Scripts

Utility scripts are grouped by purpose:

- `dev/` — local development orchestration
- `assets/` — metadata and artwork download/resize helpers
- `traits/` — trait ingestion and trait-type maintenance
- `release/` — production release helpers

Common commands:

```bash
yarn dev
yarn tsx scripts/traits/ingest-traits.ts
./scripts/release/build-frontend-release.sh
```
