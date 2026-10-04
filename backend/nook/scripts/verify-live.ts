import { once } from 'node:events'
import Kernel from '@onkernel/sdk'
import { loadConfig } from '../src/config.js'
import { Store } from '../src/store.js'
import { Jobs } from '../src/jobs.js'
import { createMastraReasoner } from '../src/ai.js'
import { createExaResearch } from '../src/research.js'
import { createKernelBrowser } from '../src/browser.js'
import { createHttpServer } from '../src/http.js'
import { runDemo } from './demo-flow.js'

const config = { ...loadConfig(), port: 0, host: '127.0.0.1' }
const store = new Store(':memory:')
const jobs = new Jobs((error) => {
  let message = error instanceof Error ? error.message : 'Unknown failure'
  if (
    error &&
    typeof error === 'object' &&
    'responseBody' in error &&
    typeof error.responseBody === 'string'
  ) {
    message += ` ${error.responseBody}`
  }
  for (const secret of [
    config.provider.key,
    config.provider.exaKey,
    config.kernelKey,
    process.env.FLY_API_TOKEN
  ]) {
    if (secret) {
      message = message.replaceAll(secret, '[redacted]')
    }
  }
  console.error(
    JSON.stringify({
      jobErrorType: error instanceof Error ? error.name : 'unknown',
      message: message.slice(0, 1500)
    })
  )
})
const kernel = new Kernel({ apiKey: config.kernelKey, maxRetries: 0 })
const before = await kernel.browsers.list()
const server = createHttpServer(config, {
  store,
  jobs,
  reasoner: createMastraReasoner(config.provider),
  research: createExaResearch(config.provider),
  browser: createKernelBrowser(config.kernelKey, config.browserDomains),
  browserDomains: config.browserDomains
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
try {
  const address = server.address()
  if (!address || typeof address !== 'object') {
    throw new Error('Test server did not start.')
  }
  console.log(
    JSON.stringify(await runDemo(`http://127.0.0.1:${address.port}`, config.registrationKey))
  )
  const after = await kernel.browsers.list()
  if (after.items.length > before.items.length) {
    throw new Error('Kernel browser session was not cleaned up.')
  }
  console.log(JSON.stringify({ kernelSessionCleanupVerified: true }))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live verification failed.')
  process.exitCode = 1
} finally {
  await jobs.stop()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  store.close()
}
