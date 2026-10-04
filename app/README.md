# Nook

A light personal decision workspace with an editable Twin profile, independent wellbeing/work/relationship perspectives, a critic, and Twin synthesis. The mobile interface has a logo and hamburger at the top and Today/Council/Circle/My Twin navigation at the bottom.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev -- --host 127.0.0.1
```

Open the URL printed by the server (normally http://127.0.0.1:5173).

```sh
npm run typecheck
npm test
npm run build
```

## Current behavior

On opening, users who have not completed onboarding are asked for their name, priority, and values, with optional background, LinkedIn, Instagram, and website links. Completion and profile details are saved in this browser; details can be edited under You. Links are stored without importing social account data. Background answers are included in live council context when the user enables live AI.

The local preview works without credentials. Questions, profile preferences, decisions, and per-friend plan states are saved in this browser. The preview offers illustrative perspectives; arbitrary questions use reflection prompts rather than invented personal details. Saved recommendations keep the profile snapshot used to generate them. Invalid saved data is preserved rather than overwritten.

The council API implements three independent specialist model calls in parallel, followed by an independent critic and a Twin synthesis. It validates inputs and outputs, cancels unfinished requests, keeps credentials server-side, and requires sign-in and a request budget for live calls.

To enable live council locally, copy `.env.example` to `.dev.vars`, provide `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` (or your own `GOOGLE_API_KEY`), and restart the server. `GOOGLE_MODEL` selects the Gemini model (default `gemini-2.5-flash`). Generic AI configuration takes precedence, followed by Google when configured; `OPENAI_API_KEY` and `OPENAI_MODEL` remain supported as an alternative. Use the local sign-in link exposed under Privacy & live AI, live AI is enabled after sign-in when a key is configured, and can be switched off under Privacy & live AI. Live processing sends the current question, recent conversation when supplied, and stated Twin profile to the configured provider. Local storage does not imply local model processing.

Friend representatives and their negotiations are sample experiences. Adding a connection creates a local placeholder. Saving a plan records interest locally; no friend is contacted, no calendar is changed, and no booking is made. With live AI enabled, team conversations and tentative plan suggestions use the configured model. Plan generation never impersonates or contacts the friend.

## Workflow configuration

Local server credentials live in ignored `.dev.vars` (restrict permissions to `0600`). `.env.example` lists names and non-secret defaults. Never put service credentials in client environment variables or committed files.

`AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` select an OpenAI-compatible provider for all five council calls. For OpenRouter use `https://openrouter.ai/api/v1` and `openai/gpt-4.1-mini`. Generic AI settings take precedence; existing Google Gemini and direct OpenAI settings remain fallbacks. The server validates provider URLs before making requests.

`EXA_API_KEY`, `KERNEL_API_KEY`, `FLY_API_TOKEN`, and `NOOK_REGISTRATION_KEY` are read by the server workflow configuration helper. Its capability flags contain booleans only. These credentials prepare web research, browser execution, deployment, and registration integrations; those workflows are not yet implemented. Supplying a token does not trigger a deployment, browser task, or registration.

Run `npm run workflows:status` from `app` to check configuration without printing credentials. This checks presence, not connectivity. Restart the local server after changing `.dev.vars`. Hosted deployments require the same values in the hosting platform's server secret store; local credentials are not automatically uploaded.

## Boundaries

This is a personal-use first version. Data does not sync across devices. The request budget is per-process (10 consultations/hour and one at a time per authenticated user); replace it with a durable budget before multi-instance use. Authentication relies on the trusted hosting sign-in headers; do not expose a raw Worker behind an untrusted proxy that permits callers to inject those headers. The local preview simulates sign-in on loopback only.

Live-provider verification is performed separately from tests, using the local ignored secrets file. Orchestration is covered by mocked-provider tests, and local API validation/unconfigured behavior has been checked.

## Source

- `app/page.tsx`: conversation workspace, Twin preferences, council/circle sheets, mobile navigation.
- `app/globals.css`: responsive light theme and accessible interaction states.
- `app/api/council/route.ts`: live council boundary, authentication, request budget, cancellation.
- `lib/council-agent.ts`: specialist → critic → Twin orchestration.
- `lib/workspace.ts`: saved-state and result validation.
- `tests/`: orchestration, cancellation, persisted-state, and budget regressions.

## Migrated backend

Configure NOOK_API_URL and the secret NOOK_REGISTRATION_KEY to route live council requests through the Nook backend on Fly.io, where Mastra runs the council and Exa supplies public research. Direct Google/OpenAI provider configuration remains supported as a fallback. Backend bearer identities are held per signed-in user on the server; profile submissions remain request context rather than automatically confirmed memories.
