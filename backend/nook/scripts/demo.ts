import { runDemo } from './demo-flow.js'
try {
  console.log(
    JSON.stringify(
      await runDemo(
        process.env.NOOK_BASE_URL || 'http://127.0.0.1:8788',
        process.env.NOOK_REGISTRATION_KEY
      )
    )
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo failed.')
  process.exitCode = 1
}
