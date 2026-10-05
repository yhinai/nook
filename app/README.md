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

Chat is conversational: Nook asks for missing details, uses the recent conversation to understand follow-ups, and searches public sources with Exa when current information is needed. “Find dinner” should lead to a question about location and preferences; a follow-up with those details can produce researched options with source links. It does not invent restaurant hours, reservations, prices, or actions taken.

Configure server-only keys in `.dev.vars`, then restart the frontend. `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` select an OpenAI-compatible provider; `OPENROUTER_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_API_KEY` are supported alternatives. Add `EXA_API_KEY` for public research. Alternatively, set `NOOK_API_URL` and `NOOK_REGISTRATION_KEY` to a backend with `/v1/chat` support. Without AI credentials, chat explains the missing connection instead of producing canned responses. When research is unavailable, that state is visible. Researched replies pass through a separate AI evidence review; quoted support and source links are validated before display. Current prices and availability remain unverified unless separately confirmed.

Current questions, recent conversation and stated Twin preferences are processed by the configured AI provider. Exa receives a focused public search query rather than the complete profile. Keys and backend bearer tokens remain server-side. Live access requires hosting authentication; loopback development supports a local identity only.

Profiles, conversations, saved messages, local connections and plan states are kept on this device. Saved messages retain their source links and the profile snapshot used when generated. Existing saved council reflections remain readable. Connect Twins by creating and accepting an invitation code. Explicit chat commands such as “invite Maya for dinner” deliver a message to the connected Twin’s backend inbox. Unknown or ambiguous recipients receive nothing. Calendar changes and bookings are not performed.

## Boundaries

This is a personal-use first version. Data does not sync across devices. The request budget is per-process (10 consultations/hour and one at a time per authenticated user); replace it with a durable budget before multi-instance use. Authentication relies on the trusted hosting sign-in headers; do not expose a raw Worker behind an untrusted proxy that permits callers to inject those headers. The local preview simulates sign-in on loopback only.

The migrated backend path has been verified with real providers through the local frontend: onboarding, loopback sign-in, explicit live-mode opt-in, council reasoning, and a synthetic question. Backend and frontend regression tests also cover validation, authentication, cancellation, identity isolation, and saved-state migration.

## Source

- `app/page.tsx`: conversation workspace, Twin preferences, council/circle sheets, mobile navigation.
- `app/globals.css`: responsive light theme and accessible interaction states.
- `app/api/chat/route.ts`: conversational AI boundary, authentication, request budget, cancellation.
- `lib/chat-agent.ts`: provider-backed conversation planning, Exa research and grounded replies.
- `app/api/council/route.ts`: specialist council API for explicit council use.
- `lib/council-agent.ts`: specialist → critic → Twin orchestration.
- `lib/workspace.ts`: saved-state and result validation.
- `tests/`: orchestration, cancellation, persisted-state, and budget regressions.

## Backend migration

The frontend registers a separate backend identity per signed-in hosting user and keeps bearer tokens server-side. The adapter caches bearer tokens per process and restores the same backend identity through authenticated session registration after a restart. Submitted profiles are request context only: they are not silently confirmed as long-term memories. Existing backend interviews, confirmed-memory review, connections, negotiations, Kernel tasks, and persistent SQLite data retain their API contracts. The UI circle and persona samples remain local previews.

## Workflow configuration

Run `npm run workflows:status` to check server credential presence without printing secrets. `lib/workflow-config.ts` reads optional Exa, Kernel, Fly and registration credentials. Presence checks do not verify connectivity or perform external actions. Keep local secrets in ignored `.dev.vars`; hosted secrets must be configured separately.

## Conversation reliability

When the configured compatible provider reports exhausted credits, throttling or an outage, chat can use the configured Google key as a fallback. Credentials errors remain actionable errors. Delivery requests carry stable IDs so a network retry cannot duplicate a Twin message. Circle shows active connection status, incoming messages and explicit replies; local contact names are labelled separately. Backend chat cancels active model work when its HTTP client disconnects.

For isolated browser verification, run `backend/nook/scripts/verify-twin-ui.ts` with `NOOK_VERIFY_DIRECTORY` pointing at a temporary directory. It uses an in-memory database, synthetic Maya account and fixture replies on loopback port 8879; it never contacts a real person or AI provider.
