import { loadConfig } from './config.js'
import { Store } from './store.js'
import { Jobs } from './jobs.js'
import { createMastraReasoner } from './ai.js'
import { createExaResearch } from './research.js'
import { createKernelBrowser } from './browser.js'
import { createHttpServer } from './http.js'
import { recoverInterruptedJobs } from './recovery.js'
import { ApiError } from './errors.js'
import { z } from 'zod'

const config = loadConfig()
const store = new Store(config.database)
recoverInterruptedJobs(store)
const jobs = new Jobs((error) => {
  const provider = z.object({ statusCode: z.number().optional() }).passthrough().safeParse(error)
  console.error(
    JSON.stringify({
      event: 'job.failed',
      type: error instanceof Error ? error.name : 'unknown',
      code: error instanceof ApiError ? error.code : undefined,
      providerStatus: provider.success ? provider.data.statusCode : undefined
    })
  )
})
const server = createHttpServer(config, {
  store,
  jobs,
  reasoner: createMastraReasoner(config.provider),
  research: createExaResearch(config.provider),
  browser: createKernelBrowser(config.kernelKey, config.browserDomains),
  browserDomains: config.browserDomains
})
server.listen(config.port, config.host, () =>
  console.log(JSON.stringify({ service: 'Nook', address: config.host, port: config.port }))
)
let closing = false
async function shutdown() {
  if (closing) {
    return
  }
  closing = true
  server.close()
  await jobs.stop()
  server.closeAllConnections()
  store.close()
}
process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
