import { z } from 'zod'
import { loadConfig } from '../src/config.js'
import { createMastraReasoner } from '../src/ai.js'
const config = loadConfig()
try {
  const result = await createMastraReasoner(config.provider).generate(
    'strategist',
    { instruction: 'Return status ok.' },
    z.object({ status: z.literal('ok') }),
    AbortSignal.timeout(45000)
  )
  console.log(JSON.stringify({ modelVerified: result.status === 'ok' }))
} catch (error) {
  let message = error instanceof Error ? error.message : 'Unknown failure'
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
      type: error instanceof Error ? error.name : 'unknown',
      message: message.slice(0, 1500)
    })
  )
  process.exitCode = 1
}
