# TwinCouncil

A digital twin that knows what matters to me, researches what is true in the world, and puts the
two together. Exa supplies the facts; the twin supplies the personal weighting; a council of
advisors argues it out. It advises and researches. It never books, buys, RSVPs, or messages anyone.

```
                    question
                       │
                     TWIN ── route: about me, or about the world?
              ┌────────┴─────────┐
        TWIN MEMORY          EXA MISSION                 research · travel · compare · discover · current
   "what do I know       "what is true in       ──►  evidence: query, source, title, url, published_date,
    about them?"          the world?"                 relevance, claim, evidence, confidence
              │                  │
              │           KERNEL live check          top sources re-read in a cloud browser
              └────────┬─────────┘
                    COUNCIL                           career · finance · lifestyle
                       │
                   SYNTHESIS ──► recommendation: ranked options with match %, conditions,
                                 what current facts changed, sources
```

Every question follows that one path. A question about me ("what do I usually prefer?") is answered
from memory and never reaches Exa.

## How the pieces fit

| Piece | Job | Where |
|---|---|---|
| **Mastra** | Runs eleven agents and three fixed workflows (`ask`, `negotiate`, `event-scout`); serves the HTTP API | `src/mastra/` |
| **Exa** | The only search engine, through its hosted MCP server | `src/twin/exa.ts` |
| **Kernel** | A read-only cloud browser: re-checks claims on the live page, opens event pages | `src/twin/kernel.ts` |
| **Fly.io** | One Machine that scales to zero, with a volume for memory and output | `Dockerfile`, `fly.toml` |
| **Claude** | The model behind every agent (`anthropic/claude-opus-5-5`) | `src/mastra/*agents.ts` |

## Three things it does

**Ask** (`src/mastra/workflows/ask.ts`): route → Exa mission → live check → council → recommendation.

```sh
npm run twin -- ask "Should I accept an offer from <company>?"
npm run twin -- ask "Find a weekend trip with Sam, under $300, good hiking and food" --with sam
npm run twin -- ask "What do I usually care about when I pick a city?"     # memory only, no Exa
```

**Negotiate** (`workflows/negotiate.ts`): two twins, each seeing only its own person's memory,
state positions, share one Exa mission, score the same three plans, and the plan whose less-happy
side is happiest wins. `alice` and `bob` are seeded demo personas.

```sh
npm run twin -- negotiate --a alice --b bob "Find something to do together this weekend"
```

**Scout events** (`workflows/event-scout.ts`): for a week's visit or a permanent move to any city:
find 20+ events on Exa, open each page in Kernel, drop what is past, sold out or out of range, keep
the best 10, research the announced speakers, write `events.md`.

```sh
npm run twin -- scout --city "New York, NY" --start 2026-10-19 --end 2026-10-25
npm run twin -- scout --city "Berlin" --mode relocate     # moving there: 30 days, favours recurring groups
```

**Memory** lives in `memory/<person>.json`:

```sh
npm run twin -- remember "I dislike long commutes" --kind preference
npm run twin -- remember "Vegetarian, prefers casual places" --person sam
npm run twin -- memory
```

## Run it locally

Needs Node 22.18 or newer.

```sh
cp .env.example .env     # ANTHROPIC_API_KEY and EXA_API_KEY; KERNEL_API_KEY for live page checks
npm install
npm run twin -- ask "..."
npm run dev              # Mastra Studio at http://localhost:4111
```

## Deploy to Fly.io

```sh
fly apps create <your-app-name>     # then set `app` in fly.toml
fly secrets set ANTHROPIC_API_KEY=... KERNEL_API_KEY=... EXA_API_KEY=... TWIN_API_TOKEN=$(openssl rand -hex 32)
fly deploy --ha=false               # one Machine; the volume is created on first deploy
```

| Route | Body | Returns |
|---|---|---|
| `POST /twin/ask` | `{ question, person?, others? }` | NDJSON: progress lines, then `{ result }` with the markdown |
| `POST /twin/negotiate` | `{ a, b, request }` | NDJSON, same shape |
| `GET` / `POST /twin/memory/:person` | `{ text, kind? }` | That person's memory |
| `POST /twin/scout` | `{ city, mode?, start?, end? }` or `{}` | `202`; then `GET /twin/status`, `GET /twin/events.md` |

Every route needs `Authorization: Bearer $TWIN_API_TOKEN`. The Machine exits after 10 idle minutes
and starts again on the next request.

## Who sees what

Private memory and untrusted web content never meet inside an agent that can reach the outside.

| Agent | Sees memory | Reads web content | Tools |
|---|---|---|---|
| Twin (routes, decides) | yes | evidence, fenced | none |
| Career, Finance, Lifestyle | yes | evidence, fenced | none |
| Researcher, Scout, People | no, only a brief | yes | Exa search |
| Checker, Verifier | no | raw pages, fenced | none |
| Mediator | no, only stated positions | evidence, fenced | none |

Also enforced in code, not left to a prompt: memory questions carry no brief to Exa; the browser is
driven by code, opens a URL, reads it, and aborts every request that is not a GET; event dates,
sold-out and past checks run on extracted facts; people are filtered against the names announced on
the event page; the negotiated plan is picked by a fixed rule. There is no egress firewall (Fly
does not provide one), so these tool restrictions are the control.

## Assumptions to replace

- **Me**: memory for `me` is seeded from five interests and a home base of San Francisco (this
  machine's timezone). Edit `src/twin/profile.ts` or use `remember`.
- **Itinerary**: moving to San Francisco, plus a placeholder week in New York.
- **Council**: three advisors. Add one in `src/mastra/council-agents.ts` and `src/twin/council.ts`.
