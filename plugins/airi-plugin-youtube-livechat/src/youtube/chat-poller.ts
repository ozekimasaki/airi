import { useLogg } from '@guiiai/logg'

import type { LiveChatMessage, YouTubeAPI } from './api'

const log = useLogg('LiveChatPoller')

export interface LiveChatPollerConfig {
  youtubeAPI: YouTubeAPI
  liveChatId: string
  onMessage: (message: LiveChatMessage) => void
  onError?: (error: unknown) => void
  onEnd?: () => void
}

export class LiveChatPoller {
  private youtubeAPI: YouTubeAPI
  private liveChatId: string
  private onMessage: (message: LiveChatMessage) => void
  private onError?: (error: unknown) => void
  private onEnd?: () => void

  private isRunning = false
  private nextPageToken?: string
  private pollingInterval = 5000 // Default 5 seconds
  private seenMessageIds = new Set<string>()
  private pollTimeoutId?: ReturnType<typeof setTimeout>
  private consecutiveErrors = 0
  private maxConsecutiveErrors = 5

  constructor(config: LiveChatPollerConfig) {
    this.youtubeAPI = config.youtubeAPI
    this.liveChatId = config.liveChatId
    this.onMessage = config.onMessage
    this.onError = config.onError
    this.onEnd = config.onEnd
  }

  start(): void {
    if (this.isRunning) {
      log.warn('Poller is already running')
      return
    }

    this.isRunning = true
    this.consecutiveErrors = 0
    log.log('Starting live chat poller for:', this.liveChatId)
    this.poll()
  }

  stop(): void {
    this.isRunning = false
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId)
      this.pollTimeoutId = undefined
    }
    log.log('Stopped live chat poller')
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    try {
      const result = await this.youtubeAPI.getLiveChatMessages(
        this.liveChatId,
        this.nextPageToken,
      )

      // Reset consecutive errors on success
      this.consecutiveErrors = 0

      // Update polling interval based on API response
      this.pollingInterval = result.pollingIntervalMillis

      // Update page token for next request
      this.nextPageToken = result.nextPageToken

      // Process new messages
      for (const message of result.messages) {
        // Skip if we've already seen this message
        if (this.seenMessageIds.has(message.id)) {
          continue
        }

        // Add to seen set
        this.seenMessageIds.add(message.id)

        // Emit message
        this.onMessage(message)
      }

      // Clean up old message IDs to prevent memory leak
      // Keep only the most recent 1000 message IDs
      if (this.seenMessageIds.size > 1000) {
        const idsArray = Array.from(this.seenMessageIds)
        this.seenMessageIds = new Set(idsArray.slice(-500))
      }

      // Schedule next poll
      this.scheduleNextPoll()
    }
    catch (error: unknown) {
      this.consecutiveErrors++
      log.withError(error).error(`Poll error (${this.consecutiveErrors}/${this.maxConsecutiveErrors})`)

      // Check for specific error codes
      const errorResponse = (error as { response?: { status?: number } })?.response
      if (errorResponse?.status === 403) {
        // Quota exceeded or forbidden
        log.error('API access forbidden. Check quota or permissions.')
        this.onError?.(error)
        this.stop()
        return
      }

      if (errorResponse?.status === 404) {
        // Live chat ended or not found
        log.log('Live chat ended or not found')
        this.onEnd?.()
        this.stop()
        return
      }

      this.onError?.(error)

      // Stop if too many consecutive errors
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        log.error('Too many consecutive errors, stopping poller')
        this.stop()
        return
      }

      // Exponential backoff for errors
      const backoffMs = Math.min(
        this.pollingInterval * 2 ** this.consecutiveErrors,
        60000, // Max 1 minute
      )
      log.log(`Retrying in ${backoffMs}ms...`)
      this.scheduleNextPoll(backoffMs)
    }
  }

  private scheduleNextPoll(customInterval?: number): void {
    if (!this.isRunning) {
      return
    }

    const interval = customInterval ?? this.pollingInterval
    this.pollTimeoutId = setTimeout(() => this.poll(), interval)
  }
}
