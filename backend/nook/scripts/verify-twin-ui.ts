// Isolated manual browser fixture. This is never used by the production server.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from '../src/config.js'
import { Store } from '../src/store.js'
import { Jobs } from '../src/jobs.js'
import { createHttpServer } from '../src/http.js'
import { register } from '../src/memory.js'
import { invite } from '../src/connections.js'
import type { Reasoner } from '../src/ai.js'

const directory = process.env.NOOK_VERIFY_DIRECTORY
if (!directory) throw new Error('Set NOOK_VERIFY_DIRECTORY to an isolated temporary directory.')
const store = new Store(':memory:')
const maya = register(store, { displayName: 'Maya' })
const invitation = invite(store, maya.user.id)
writeFileSync(resolve(directory, 'fixture.json'), JSON.stringify({ mayaToken: maya.token, invitationToken: invitation.invitationToken }), { mode: 0o600 })
const jobs = new Jobs()
const reasoner: Reasoner = {
  enabled: true,
  async generate(_role, context, schema) {
    const plan = schema.safeParse({ searchQuery: null, clarification: null })
    if (plan.success) return plan.data
    return schema.parse({ message: `Local verification reply: ${JSON.parse(JSON.stringify(context)).question}` })
  }
}
const config = loadConfig({ PORT: '8879', NOOK_PROVIDER_DIRECTORY: directory, NOOK_REGISTRATION_KEY: 'nook-verification-only' })
const server = createHttpServer(config, { store, jobs, reasoner, research: { enabled: false, search: async () => ({ status: 'off', sources: [] }) }, browser: { enabled: false, read: async () => { throw new Error('Disabled in fixture') } }, browserDomains: [] })
server.listen(8879, '127.0.0.1', () => console.log('Isolated Twin verification backend ready on 8879'))
process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); void jobs.stop().then(() => store.close()) })
