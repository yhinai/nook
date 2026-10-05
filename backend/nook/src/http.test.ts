import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { z } from 'zod'
import { Store } from './store.js'
import { Jobs } from './jobs.js'
import { loadConfig } from './config.js'
import { createHttpServer } from './http.js'

const registration = z.object({ user: z.object({ id: z.string() }), token: z.string() })
test('HTTP authentication, registration gate, owner isolation, CORS, JSON limits and OpenAPI', async () => {
  const store = new Store(':memory:')
  const jobs = new Jobs()
  const server = createHttpServer(
    {
      ...loadConfig({}),
      port: 0,
      registrationKey: 'test-registration-key',
      allowedOrigins: ['https://allowed.example']
    },
    {
      store,
      jobs,
      reasoner: {
        enabled: false,
        async generate() {
          throw new Error('disabled')
        }
      },
      research: {
        enabled: false,
        async search() {
          return { status: 'off', sources: [] }
        }
      },
      browser: {
        enabled: false,
        async read() {
          throw new Error('disabled')
        }
      },
      browserDomains: ['github.com']
    }
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  try {
    const request = (
      path: string,
      body?: unknown,
      token?: string,
      extra: Record<string, string> = {}
    ) =>
      fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...extra
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    assert.equal((await request('/v1/profile')).status, 401)
    assert.equal((await request('/v1/chat', {})).status, 401)
    assert.equal((await request('/v1/users', { displayName: 'A' })).status, 403)
    const register = async (name: string) =>
      registration.parse(
        await (
          await request('/v1/users', { displayName: name }, undefined, {
            'X-Nook-Registration-Key': 'test-registration-key'
          })
        ).json()
      )
    const a = await register('Alex')
    assert.equal((await request('/v1/chat', {
      question: 'Find dinner',
      profile: { name: 'Alex', priority: 'Friends', values: ['Friends'], weekend: true }
    }, a.token)).status, 503)
    const b = await register('Blair')
    assert.equal((await request('/v1/twins')).status, 401)
    const directory = await (await request('/v1/twins', undefined, a.token)).json()
    assert.deepEqual(directory, [{ id: b.user.id, displayName: 'Blair', status: 'available' }])
    const connect = await request('/v1/connections/requests', { recipientId: b.user.id }, a.token)
    assert.equal(connect.status, 201)
    const pending = await connect.json()
    assert.equal(pending.phase, 'invited')
    assert.equal((await (await request('/v1/connections/requests', { recipientId: b.user.id }, a.token)).json()).id, pending.id)
    assert.equal((await request('/v1/connections/respond', { connectionId: pending.id, decision: 'accept' }, a.token)).status, 403)
    assert.equal((await request('/v1/agent/messages', { connectionId: pending.id, content: 'Hello', requestId: crypto.randomUUID() }, a.token)).status, 409)
    assert.equal((await (await request('/v1/twins', undefined, b.token)).json())[0].status, 'incoming')
    assert.equal((await request('/v1/connections/respond', { connectionId: pending.id, decision: 'accept' }, b.token)).status, 200)
    assert.equal((await (await request('/v1/twins', undefined, a.token)).json())[0].status, 'connected')
    assert.equal((await request('/v1/agent/messages', { connectionId: pending.id, content: 'Hello', requestId: crypto.randomUUID() }, a.token)).status, 201)
    assert.equal((await (await request('/v1/agent/messages', undefined, b.token)).json())[0].content, 'Hello')
    const memory = z.object({ id: z.string(), revision: z.number() }).parse(
      await (
        await request(
          '/v1/memories',
          {
            dimension: 'values',
            kind: 'explicit',
            field: 'friends',
            statement: 'I value friends.',
            value: 'friends'
          },
          a.token
        )
      ).json()
    )
    assert.equal((await request(`/v1/memories/${memory.id}`, undefined, b.token)).status, 404)
    assert.equal(
      (
        await request(
          `/v1/memories/${memory.id}/review`,
          { expectedRevision: 0, status: 'confirmed' },
          b.token
        )
      ).status,
      404
    )
    assert.equal(
      (
        await request(
          `/v1/memories/${memory.id}/review`,
          { expectedRevision: 0, status: 'confirmed' },
          a.token
        )
      ).status,
      200
    )
    assert.equal((await request(`/v1/profile?token=${a.token}`)).status, 400)
    assert.equal(
      (await request('/v1/profile', undefined, a.token, { Origin: 'https://evil.example' })).status,
      403
    )
    const allowed = await request('/v1/profile', undefined, a.token, {
      Origin: 'https://allowed.example'
    })
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example')
    assert.equal(
      (await request('/v1/memories', { statement: 'x'.repeat(70000) }, a.token)).status,
      413
    )
    assert.equal(
      (await request('/v1/decisions', { objective: 'A', options: [] }, a.token)).status,
      400
    )
    const openapi = await (await request('/openapi.json')).json()
    assert.equal(openapi.openapi, '3.1.0')
    assert.ok(openapi.paths['/v1/negotiations/{id}/approval'])
    assert.equal((await request('/v1/interviews', {}, a.token)).status, 201)
  } finally {
    await jobs.stop()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    store.close()
  }
})
test('production listening requires a registration secret', () => {
  const store = new Store(':memory:')
  assert.throws(
    () =>
      createHttpServer(
        { ...loadConfig({}), host: '0.0.0.0' },
        {
          store,
          jobs: new Jobs(),
          reasoner: {
            enabled: false,
            async generate() {
              throw new Error('disabled')
            }
          },
          research: {
            enabled: false,
            async search() {
              return { status: 'off', sources: [] }
            }
          },
          browser: {
            enabled: false,
            async read() {
              throw new Error('disabled')
            }
          },
          browserDomains: []
        }
      ),
    /NOOK_REGISTRATION_KEY/
  )
  store.close()
})
