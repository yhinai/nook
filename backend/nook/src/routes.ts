import { z } from 'zod'
import * as contracts from './contracts.js'
import type { Store } from './store.js'
import type { Jobs } from './jobs.js'
import type { Reasoner } from './ai.js'
import type { Research } from './research.js'
import { browserInput, browserSchema, startBrowserRead, type PublicBrowser } from './browser.js'
import {
  register,
  profile,
  createMemory,
  reviewMemory,
  memoryReview,
  changeVisibility,
  visibilityInput
} from './memory.js'
import { createInterview, answerInterview, finishInterview, answerSchema } from './interview.js'
import { startDecision } from './decisions.js'
import { invite, accept, grant, revoke, memberConnection, connectionView } from './connections.js'
import {
  createNegotiation,
  readNegotiation,
  submitBrief,
  approvePlan
} from './negotiation-records.js'
import { startNegotiation } from './negotiations.js'

export type Services = {
  store: Store
  jobs: Jobs
  reasoner: Reasoner
  research: Research
  browser: PublicBrowser
  browserDomains: string[]
}
type Context = { ownerId: string; resourceId: string; body: unknown }
export type Route = {
  method: string
  path: string
  auth: boolean
  status: number
  schema?: z.ZodType
  action: (context: Context) => unknown
}
export function createRoutes(services: Services): Route[] {
  const { store, jobs, reasoner, research, browser, browserDomains } = services
  const route = (
    method: string,
    path: string,
    action: Route['action'],
    schema?: z.ZodType,
    status = 200,
    auth = true
  ): Route => ({ method, path, action, schema, status, auth })
  const connection = (ownerId: string, resourceId: string) =>
    connectionView(store, memberConnection(store, resourceId, ownerId, false), ownerId)
  return [
    route(
      'GET',
      '/health',
      () => ({
        name: 'Nook',
        status: 'ok',
        capabilities: { mastra: reasoner.enabled, exa: research.enabled, kernel: browser.enabled },
        browserDomains
      }),
      undefined,
      200,
      false
    ),
    route(
      'POST',
      '/users',
      ({ body }) => register(store, body),
      z.object({ displayName: z.string().trim().min(1).max(100) }).strict(),
      201,
      false
    ),
    route('GET', '/profile', ({ ownerId }) => profile(store, ownerId)),
    route('GET', '/memories', ({ ownerId }) =>
      store.list('memory', contracts.memorySchema, ownerId)
    ),
    route(
      'POST',
      '/memories',
      ({ ownerId, body }) => createMemory(store, ownerId, body),
      contracts.memoryInput,
      201
    ),
    route('GET', '/memories/{id}', ({ ownerId, resourceId }) =>
      store.owned('memory', resourceId, ownerId, contracts.memorySchema)
    ),
    route(
      'POST',
      '/memories/{id}/review',
      ({ ownerId, resourceId, body }) => reviewMemory(store, ownerId, resourceId, body),
      memoryReview
    ),
    route(
      'PATCH',
      '/memories/{id}/visibility',
      ({ ownerId, resourceId, body }) => changeVisibility(store, ownerId, resourceId, body),
      visibilityInput
    ),
    route(
      'POST',
      '/interviews',
      ({ ownerId }) => createInterview(store, ownerId),
      z.object({}).strict(),
      201
    ),
    route('GET', '/interviews/{id}', ({ ownerId, resourceId }) => ({
      ...store.owned('interview', resourceId, ownerId, contracts.interviewSchema),
      questions: contracts.interviewQuestions
    })),
    route(
      'POST',
      '/interviews/{id}/answers',
      ({ ownerId, resourceId, body }) => answerInterview(store, ownerId, resourceId, body),
      answerSchema
    ),
    route(
      'POST',
      '/interviews/{id}/extract',
      ({ ownerId, resourceId }) => finishInterview(store, jobs, reasoner, ownerId, resourceId),
      z.object({}).strict(),
      202
    ),
    route('GET', '/decisions', ({ ownerId }) =>
      store.list('decision', contracts.decisionSchema, ownerId)
    ),
    route(
      'POST',
      '/decisions',
      ({ ownerId, body }) => startDecision(store, jobs, reasoner, research, ownerId, body),
      contracts.decisionInput,
      202
    ),
    route('GET', '/decisions/{id}', ({ ownerId, resourceId }) =>
      store.owned('decision', resourceId, ownerId, contracts.decisionSchema)
    ),
    route(
      'GET',
      '/decisions/{id}/events',
      ({ ownerId, resourceId }) =>
        store.owned('decision', resourceId, ownerId, contracts.decisionSchema).events
    ),
    route('GET', '/connections', ({ ownerId }) =>
      store
        .list('connection', contracts.connectionSchema)
        .filter((value) => value.ownerId === ownerId || value.recipientId === ownerId)
        .map((value) => connectionView(store, value, ownerId))
    ),
    route(
      'POST',
      '/connections/invitations',
      ({ ownerId }) => invite(store, ownerId),
      z.object({}).strict(),
      201
    ),
    route(
      'POST',
      '/connections/accept',
      ({ ownerId, body }) => accept(store, ownerId, body),
      z.object({ invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
    ),
    route('GET', '/connections/{id}', ({ ownerId, resourceId }) => connection(ownerId, resourceId)),
    route(
      'PUT',
      '/connections/{id}/grants',
      ({ ownerId, resourceId, body }) => grant(store, ownerId, resourceId, body),
      z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          memoryIds: z.array(contracts.id).max(12)
        })
        .strict()
    ),
    route(
      'POST',
      '/connections/{id}/revoke',
      ({ ownerId, resourceId }) => revoke(store, ownerId, resourceId),
      z.object({}).strict()
    ),
    route(
      'POST',
      '/negotiations',
      ({ ownerId, body }) => createNegotiation(store, ownerId, body),
      contracts.negotiationInput,
      201
    ),
    route('GET', '/negotiations/{id}', ({ ownerId, resourceId }) =>
      readNegotiation(store, ownerId, resourceId)
    ),
    route(
      'POST',
      '/negotiations/{id}/brief',
      ({ ownerId, resourceId, body }) => submitBrief(store, ownerId, resourceId, body),
      z
        .object({ expectedRevision: z.number().int().nonnegative(), brief: contracts.briefSchema })
        .strict()
    ),
    route(
      'POST',
      '/negotiations/{id}/start',
      ({ ownerId, resourceId }) => startNegotiation(store, jobs, reasoner, ownerId, resourceId),
      z.object({}).strict(),
      202
    ),
    route(
      'POST',
      '/negotiations/{id}/approval',
      ({ ownerId, resourceId, body }) => approvePlan(store, ownerId, resourceId, body),
      z
        .object({
          planHash: z.string().regex(/^[a-f0-9]{64}$/),
          decision: z.enum(['approved', 'rejected'])
        })
        .strict()
    ),
    route(
      'POST',
      '/browser/tasks',
      ({ ownerId, body }) =>
        startBrowserRead(store, jobs, reasoner, browser, browserDomains, ownerId, body),
      browserInput,
      202
    ),
    route('GET', '/browser/tasks/{id}', ({ ownerId, resourceId }) =>
      store.owned('browser', resourceId, ownerId, browserSchema)
    ),
    route('GET', '/audit', ({ ownerId }) => store.auditLog(ownerId))
  ]
}
export function openApi(routes: Route[]) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of routes) {
    const path = `/v1${route.path}`
    paths[path] ||= {}
    paths[path][route.method.toLowerCase()] = {
      operationId: route.method.toLowerCase() + route.path.replace(/\W/g, '_'),
      security: route.auth
        ? [{ bearerAuth: [] }]
        : route.path === '/users'
          ? [{ registrationKey: [] }]
          : [],
      ...(route.path.includes('{id}')
        ? {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
            ]
          }
        : {}),
      ...(route.schema
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: z.toJSONSchema(route.schema, { io: 'input' }) }
              }
            }
          }
        : {}),
      responses: {
        [route.status]: {
          description:
            route.status === 202
              ? 'Persisted job; poll its resource URL for completion.'
              : 'Success',
          content: { 'application/json': { schema: {} } }
        },
        default: { description: 'Error with code, message and requestId.' }
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Nook HTTP API',
      version: '0.1.0',
      description:
        'Confirmed personal memory, multi-perspective decisions, consented AI Twin negotiation and public-page research. Plans are proposals; approval never performs external actions.'
    },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        registrationKey: { type: 'apiKey', in: 'header', name: 'X-Nook-Registration-Key' }
      }
    }
  }
}
