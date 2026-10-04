import { readSidequestProvider } from '../../../src/main/sidequest/provider.js'
import { resolve } from 'node:path'

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const provider = readSidequestProvider(
    environment.NOOK_PROVIDER_DIRECTORY || resolve('data'),
    environment
  )
  return {
    provider,
    kernelKey: environment.KERNEL_API_KEY,
    host: environment.HOST || '127.0.0.1',
    port: Number(environment.PORT || 8788),
    database: environment.NOOK_DATABASE || resolve('data/nook.db'),
    registrationKey: environment.NOOK_REGISTRATION_KEY,
    allowedOrigins: (environment.NOOK_CORS_ORIGINS || '').split(',').filter(Boolean),
    browserDomains: (
      environment.NOOK_BROWSER_DOMAINS ||
      'github.com,mastra.ai,kernel.sh,exa.ai,en.wikipedia.org,docs.fly.io,cdc.gov,who.int'
    )
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  }
}
export type Config = ReturnType<typeof loadConfig>
