# Paged

Get paged. Fight a live production incident. Fix it with real system design, and walk away with an answer you can give in an interview.

> Work in progress: the engine and the first world are done; the playable web app is next. See [ROADMAP.md](ROADMAP.md).

- `packages/engine`: deterministic flow simulation ([how it works](docs/engine-model.md))
- `packages/scenarios`: incidents as YAML ([write one](docs/writing-scenarios.md))

```bash
pnpm install
pnpm test       # engine + scenario tests
pnpm validate   # play every scenario headless and check it teaches its lesson
```

MIT licensed.
