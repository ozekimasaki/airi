import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'

import { YouTubeLiveChatPlugin } from './plugin'

const log = useLogg('youtube-livechat').useGlobalConfig()

async function main() {
  log.log('Starting YouTube Live Chat plugin...')

  const plugin = new YouTubeLiveChatPlugin({
    airiToken: env.AIRI_TOKEN,
    airiUrl: env.AIRI_URL,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    streamUrl: env.YOUTUBE_STREAM_URL,
  })

  await plugin.start()

  // Graceful shutdown
  async function gracefulShutdown(signal: string) {
    log.log(`Received ${signal}, shutting down...`)
    await plugin.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
}

main().catch((error) => {
  log.withError(error).error('Failed to start YouTube Live Chat plugin')
  process.exit(1)
})
