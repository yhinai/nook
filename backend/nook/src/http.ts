import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Config } from './config.js'
import { ApiError, insist } from './errors.js'
import { digest } from './store.js'
import { createRoutes, openApi, type Services } from './routes.js'

const bodyLimit = 65536
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  insist(
    request.headers['content-type']?.split(';')[0] === 'application/json',
    415,
    'json_required',
    'Use Content-Type: application/json.'
  )
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    insist(size <= bodyLimit, 413, 'body_too_large', 'Request bodies must be at most 64 KiB.')
    chunks.push(bytes)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, 'invalid_json', 'Send a valid JSON body.')
  }
}
export function createHttpServer(config: Config, services: Services) {
  insist(
    Number.isInteger(config.port) && config.port >= 0 && config.port <= 65535,
    500,
    'invalid_port',
    'Configure a valid HTTP port.'
  )
  insist(
    ['127.0.0.1', '::1', 'localhost'].includes(config.host) || config.registrationKey,
    500,
    'registration_key_required',
    'Set NOOK_REGISTRATION_KEY before listening beyond localhost.'
  )
  const routes = createRoutes(services)
  const document = openApi(routes)
  const server = createServer((request, response) => {
    void handle(request, response)
  })
  server.requestTimeout = 20000
  server.headersTimeout = 15000
  server.keepAliveTimeout = 5000
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const controller = new AbortController()
    const cancel = () => { if (!response.writableEnded) controller.abort() }
    request.once('aborted', cancel)
    response.once('close', cancel)
    const requestId = randomUUID()
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Request-Id', requestId)
    const send = (status: number, value: unknown) => {
      response.writeHead(status)
      response.end(JSON.stringify(value))
    }
    try {
      const origin = request.headers.origin
      if (origin) {
        insist(
          config.allowedOrigins.includes(origin),
          403,
          'origin_blocked',
          'This browser origin is not allowed.'
        )
        response.setHeader('Access-Control-Allow-Origin', origin)
        response.setHeader('Vary', 'Origin')
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,OPTIONS')
        response.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type,Authorization,X-Nook-Registration-Key'
        )
        response.writeHead(204)
        response.end()
        return
      }
      const url = new URL(request.url || '/', 'http://localhost')
      insist(
        !url.search,
        400,
        'query_not_supported',
        'Use JSON bodies; credentials are never accepted in query parameters.'
      )
      if (request.method === 'GET' && url.pathname === '/openapi.json') {
        send(200, document)
        return
      }
      let resourceId = ''
      const route = routes.find((value) => {
        if (value.method !== request.method) {
          return false
        }
        const match = url.pathname.match(
          new RegExp(`^/v1${value.path.replace('{id}', '([a-fA-F0-9-]{36})')}$`)
        )
        if (!match) {
          return false
        }
        resourceId = match[1] || ''
        return true
      })
      insist(route, 404, 'not_found', 'Endpoint not found.')
      if (resourceId) {
        z.string().uuid().parse(resourceId)
      }
      let ownerId = ''
      if (route.auth) {
        const authorization = request.headers.authorization || ''
        insist(
          authorization.startsWith('Bearer '),
          401,
          'unauthorized',
          'A bearer token is required.'
        )
        ownerId = services.store.authenticate(authorization.slice(7))
      }
      if (route.path === '/users/session') insist(config.registrationKey, 503, 'registration_closed', 'Session registration requires a configured registration key.')
      if (route.path.startsWith('/users') && config.registrationKey) {
        const supplied = request.headers['x-nook-registration-key']
        insist(
          typeof supplied === 'string' &&
            timingSafeEqual(
              Buffer.from(digest(supplied)),
              Buffer.from(digest(config.registrationKey))
            ),
          403,
          'registration_closed',
          'A valid registration key is required.'
        )
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(request.method || '')
        ? await jsonBody(request)
        : undefined
      if (route.schema) {
        route.schema.parse(body)
      }
      const value = await route.action({ ownerId, resourceId, body, signal: controller.signal })
      send(route.status, value)
    } catch (error) {
      const status =
        error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 500
      send(status, {
        error: {
          code:
            error instanceof ApiError
              ? error.code
              : error instanceof z.ZodError
                ? 'validation_failed'
                : 'internal_error',
          message:
            error instanceof ApiError
              ? error.message
              : error instanceof z.ZodError
                ? 'Request does not match the API schema.'
                : 'The request could not be completed.',
          requestId
        }
      })
    }
  }
  return server
}
