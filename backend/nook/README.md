# Nook backend

A standalone HTTP API for a personal AI Twin and a council of Career, Finance, Health, Relationships, and Life Strategist agents. Mastra runs the agents, Exa supplies public research, Kernel reads allowed public pages, and Fly.io hosts the backend. No frontend or Orca UI changes are required.

## Run locally

Requires Node.js 24 or newer. From `backend/nook`:

```sh
npm ci
# Configure .env from .env.example if it does not already exist.
npm run typecheck
npm test
npm run build
npm start
```

The API listens on `http://127.0.0.1:8788`. Its contract is at `/openapi.json`; readiness and configured capabilities are at `/v1/health`. Configure a local `.env` using `.env.example`; it is ignored by Git. Never commit it or include it in a container image.

## Verify the complete flow

```sh
npm run verify:live
```

This starts an isolated local API with an in-memory database and real providers. It verifies interview extraction, explicit memory confirmation, four council opinions and strategist synthesis, Exa research, invitation acceptance and scoped disclosure, two negotiation rounds, both human approvals, and Kernel session cleanup. It uses synthetic people and performs no bookings, messages, purchases, or calendar changes. It consumes a small amount of provider usage.

With a running server, `npm run demo` exercises the same flow. Set `NOOK_BASE_URL` to exercise a deployed API. Demo users and work are retained in that server's database. Production registration requires `NOOK_REGISTRATION_KEY`.

## API flow

1. `POST /v1/users` with `{ "displayName": "Alex" }` returns a user, Twin, and an opaque bearer token once. Supply `X-Nook-Registration-Key` when configured. Subsequent requests use `Authorization: Bearer <token>`.
2. `POST /v1/interviews` creates an interview. Submit answers to `/v1/interviews/{id}/answers` using the returned question IDs and `expectedRevision`. Start extraction with `POST /v1/interviews/{id}/extract` and `{}`. Poll the interview until `ready` or `failed`.
3. Review extracted memories at `/v1/memories`. Each starts pending and private. `POST /v1/memories/{id}/review` explicitly confirms or rejects it. Corrections create a new memory and supply `supersedesIds` for the same field. `PATCH /v1/memories/{id}/visibility` changes disclosure eligibility explicitly.
4. `POST /v1/decisions` accepts an objective, category, and two to six supplied options. Poll `/v1/decisions/{id}` for four actual opinions and the Life Strategist recommendation; `/events` reports completed progress. Only current confirmed context is used.
5. `POST /v1/connections/invitations` prepares an invitation token without sending it. The other authenticated person accepts at `/v1/connections/accept`. Each person chooses memory IDs through `PUT /v1/connections/{id}/grants` with the current connection revision. Private and never-share memories cannot be granted.
6. `POST /v1/negotiations` supplies candidates and the first planning brief. The other person submits their own brief at `/brief`. Start `/start`, then poll for `awaiting_approval`. Two actual AI rounds evaluate feasible supplied candidates. Each person must independently approve the exact `planHash` at `/approval`. Approval only records consent; it executes no external action. Changed disclosure, expired shared memory, or a revoked connection invalidates access or the plan.
7. `POST /v1/browser/tasks` accepts an allowed public HTTPS URL and purpose. Kernel performs a fixed read-only page fetch, Mastra summarizes the retrieved text, and the remote browser is deleted. Poll `/v1/browser/tasks/{id}` for completion.

The OpenAPI document defines exact request bodies and endpoints. JSON bodies are limited to 64 KiB. Update requests use revision checks. Errors expose a code and request ID without returning credentials or private provider diagnostics.

## Providers and operational limits

- Mastra uses `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`. Exa uses `EXA_API_KEY`; Kernel uses `KERNEL_API_KEY`.
- Kernel runs in a fresh headless session, without profiles, saved logins, arbitrary agent code, or form interactions. Requests are limited to GET documents on the chosen allowlisted host. URLs with credentials, query parameters, or fragments are rejected. Configure trusted public hosts through `NOOK_BROWSER_DOMAINS`; defaults cover GitHub, Mastra, Kernel, Exa, Wikipedia, Fly docs, CDC, and WHO.
- Exa receives fixed category queries rather than the person's private interview text. Sources are untrusted context. Agent memory references and recommendation option IDs are checked.
- Memory confidence describes provenance, not a calibrated prediction. Health and finance are ordinary decision perspectives, not diagnosis or investment advice.
- SQLite persists users, token hashes, memory provenance, revision checks, jobs, progress, and approval state. Running work is marked interrupted after restart, with completed results preserved. Expired memory is excluded from retrieval.
- Four jobs run concurrently globally, with one per initiating user and a two-minute job limit. Poll persisted resources for progress. The deployment uses one instance and one volume; do not add replicas against independent SQLite volumes.

## Fly.io

The application configuration is `backend/nook/fly.toml`. From the repository root, deploy with:

```sh
fly deploy . --config backend/nook/fly.toml --remote-only --ha=false --volume-initial-size 1
```

This uses the repository root as build context; Fly resolves the configured Dockerfile relative to `backend/nook/fly.toml`. The app runs one machine with a persistent `nook_data` volume. Set the AI, Exa, Kernel, and registration secrets through `fly secrets import`. Never put `FLY_API_TOKEN` in the deployed app's secrets; it is a local deployment credential.

The Fly container reads `NOOK_DATABASE=/data/nook.db`, listens on port 8080, and checks `/v1/health`. Autostop is off so background jobs can finish. Provider calls, browser usage, and hosting consume available account credits. A 48-hour deployment token expires independently of the running app.

Official integration references: [Mastra structured output](https://mastra.ai/docs/agents/structured-output), [Kernel](https://www.kernel.sh/docs/browsers), [Exa](https://exa.ai/docs/reference/search), [Fly configuration](https://docs.fly.io/reference/configuration/).
