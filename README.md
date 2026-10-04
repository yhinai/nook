# Nook

A personal AI Twin and council backend built with Mastra, Exa, Kernel, and Fly.io.

The backend is deployed at [nook-alhinai-api.fly.dev](https://nook-alhinai-api.fly.dev/v1/health). Its [OpenAPI contract](https://nook-alhinai-api.fly.dev/openapi.json) documents the HTTP interface.

Requires Node.js 24 or newer. From this repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Configure `backend/nook/.env` using `.env.example` before running real agents. Credentials and database files are ignored by Git. Live verification is available through `npm run verify:live`.

See [backend instructions](backend/nook/README.md) for API workflows, the demo, and Fly.io deployment.

The small shared provider and research modules under `src/` are reused from [Orca](https://github.com/stablyai/orca); their MIT license and copyright notice are retained in `LICENSE`.
