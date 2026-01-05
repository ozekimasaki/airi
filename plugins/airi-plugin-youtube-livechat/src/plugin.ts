import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { Client as AiriClient } from '@proj-airi/server-sdk'

import { OAuthServer } from './oauth/server'
import { TokenStore } from './oauth/token-store'
import { YouTubeAPI } from './youtube/api'
import { LiveChatPoller } from './youtube/chat-poller'
import { formatChatMessage } from './youtube/formatter'

const log = useLogg('YouTubeLiveChatPlugin')

export interface YouTubeLiveChatPluginConfig {
  airiToken?: string
  airiUrl?: string
  clientId?: string
  clientSecret?: string
  streamUrl?: string
}

interface YouTubeModuleConfig {
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  streamUrl?: string
  startOAuth?: boolean
}

function isYouTubeConfig(config: unknown): config is YouTubeModuleConfig {
  if (typeof config !== 'object' || config === null)
    return false
  const c = config as Record<string, unknown>
  return (typeof c.enabled === 'boolean' || typeof c.enabled === 'undefined')
    && (typeof c.clientId === 'string' || typeof c.clientId === 'undefined')
    && (typeof c.clientSecret === 'string' || typeof c.clientSecret === 'undefined')
    && (typeof c.streamUrl === 'string' || typeof c.streamUrl === 'undefined')
    && (typeof c.startOAuth === 'boolean' || typeof c.startOAuth === 'undefined')
}

export class YouTubeLiveChatPlugin {
  private airiClient: AiriClient
  private oauthServer: OAuthServer
  private tokenStore: TokenStore
  private youtubeAPI: YouTubeAPI | null = null
  private chatPoller: LiveChatPoller | null = null

  private clientId: string
  private clientSecret: string
  private currentStreamUrl: string = ''
  private isPolling = false

  constructor(config: YouTubeLiveChatPluginConfig) {
    this.clientId = config.clientId || env.GOOGLE_CLIENT_ID || ''
    this.clientSecret = config.clientSecret || env.GOOGLE_CLIENT_SECRET || ''
    this.currentStreamUrl = config.streamUrl || env.YOUTUBE_STREAM_URL || ''

    // Initialize AIRI client
    this.airiClient = new AiriClient({
      name: 'youtube-livechat',
      possibleEvents: [
        'input:text',
        'module:configure',
      ],
      token: config.airiToken,
      url: config.airiUrl,
    })

    // Initialize OAuth components
    this.tokenStore = new TokenStore()
    this.oauthServer = new OAuthServer({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      tokenStore: this.tokenStore,
    })

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Handle configuration from UI via module:configure
    this.airiClient.onEvent('module:configure', async (event) => {
      log.log('Received module configuration:', event.data)

      const config = event.data.config
      if (isYouTubeConfig(config)) {
        const { enabled, clientId, clientSecret, streamUrl, startOAuth } = config

        // Update credentials if provided
        if (clientId)
          this.clientId = clientId
        if (clientSecret)
          this.clientSecret = clientSecret

        // Update OAuth server with new credentials
        this.oauthServer.updateCredentials(this.clientId, this.clientSecret)

        // Start OAuth flow if requested
        if (startOAuth) {
          log.log('Starting OAuth flow...')
          await this.oauthServer.startAuthFlow()
          return
        }

        if (enabled === false) {
          await this.stopPolling()
          return
        }

        // If stream URL changed and we have tokens, start polling
        if (streamUrl && streamUrl !== this.currentStreamUrl) {
          this.currentStreamUrl = streamUrl
          await this.startPollingForStream(streamUrl)
        }
        else if (streamUrl && !this.isPolling) {
          await this.startPollingForStream(streamUrl)
        }
      }
      else {
        log.warn('Invalid YouTube configuration received, skipping...')
      }
    })
  }

  private async startPollingForStream(streamUrl: string): Promise<void> {
    // Check if we have valid tokens
    const tokens = this.tokenStore.getTokens()
    if (!tokens) {
      log.warn('No OAuth tokens available. Please authenticate first.')
      // Start OAuth flow
      await this.oauthServer.startAuthFlow()
      return
    }

    // Initialize YouTube API if not already done
    if (!this.youtubeAPI) {
      this.youtubeAPI = new YouTubeAPI({
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        tokenStore: this.tokenStore,
      })
    }

    try {
      // Extract video ID from URL
      const videoId = this.youtubeAPI.extractVideoId(streamUrl)
      if (!videoId) {
        log.error('Could not extract video ID from URL:', streamUrl)
        return
      }

      log.log('Extracted video ID:', videoId)

      // Get live chat ID
      const liveChatId = await this.youtubeAPI.getLiveChatId(videoId)
      if (!liveChatId) {
        log.error('Could not get live chat ID. Stream may not be live.')
        return
      }

      log.log('Got live chat ID:', liveChatId)

      // Stop existing poller if any
      await this.stopPolling()

      // Start new poller
      this.chatPoller = new LiveChatPoller({
        youtubeAPI: this.youtubeAPI,
        liveChatId,
        onMessage: (message) => {
          const formattedText = formatChatMessage(message)
          log.log('Chat message:', formattedText)

          // Send to AIRI as input:text
          this.airiClient.send({
            type: 'input:text',
            data: { text: formattedText },
          })
        },
        onError: (error) => {
          log.withError(error).error('Chat poller error')
        },
        onEnd: () => {
          log.log('Live chat ended')
          this.isPolling = false
        },
      })

      this.chatPoller.start()
      this.isPolling = true
      log.log('Started polling for live chat:', liveChatId)
    }
    catch (error) {
      log.withError(error).error('Failed to start polling')
    }
  }

  private async stopPolling(): Promise<void> {
    if (this.chatPoller) {
      this.chatPoller.stop()
      this.chatPoller = null
    }
    this.isPolling = false
    log.log('Stopped live chat polling')
  }

  async start(): Promise<void> {
    log.log('Starting YouTube Live Chat plugin...')

    try {
      // Start OAuth server for callback handling
      await this.oauthServer.start()

      // Load saved tokens if any
      await this.tokenStore.load()

      log.log('YouTube Live Chat plugin started successfully')

      if (!this.clientId || !this.clientSecret) {
        log.warn('Google OAuth credentials not provided. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.')
      }
      else {
        log.log('Google OAuth credentials configured')
      }

      // If stream URL is provided and tokens exist, start polling
      if (this.currentStreamUrl && this.tokenStore.getTokens()) {
        log.log('Stream URL provided, starting polling...')
        await this.startPollingForStream(this.currentStreamUrl)
      }
      else if (this.currentStreamUrl) {
        log.log('Stream URL provided but no tokens. Starting OAuth flow...')
        await this.oauthServer.startAuthFlow()
      }
    }
    catch (error) {
      log.withError(error).error('Failed to start YouTube Live Chat plugin')
      throw error
    }
  }

  async stop(): Promise<void> {
    log.log('Stopping YouTube Live Chat plugin...')
    try {
      await this.stopPolling()
      await this.oauthServer.stop()
      this.airiClient.close()
      log.log('YouTube Live Chat plugin stopped')
    }
    catch (error) {
      log.withError(error).error('Error stopping YouTube Live Chat plugin')
      throw error
    }
  }
}
