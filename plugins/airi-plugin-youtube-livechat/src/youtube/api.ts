import { google, type youtube_v3 } from 'googleapis'

import { useLogg } from '@guiiai/logg'

import type { TokenStore } from '../oauth/token-store'

const log = useLogg('YouTubeAPI')

export interface YouTubeAPIConfig {
  clientId: string
  clientSecret: string
  tokenStore: TokenStore
}

export interface LiveChatMessage {
  id: string
  authorDisplayName: string
  authorChannelId: string
  messageText: string
  publishedAt: string
  // Super Chat / Super Sticker fields
  superChatDetails?: {
    amountDisplayString: string
    amountMicros: string
    currency: string
    tier: number
    userComment?: string
  }
  superStickerDetails?: {
    amountDisplayString: string
    amountMicros: string
    currency: string
    tier: number
    superStickerMetadata?: {
      stickerId: string
      altText: string
      language: string
    }
  }
}

export class YouTubeAPI {
  private oauth2Client: InstanceType<typeof google.auth.OAuth2>
  private youtube: youtube_v3.Youtube
  private tokenStore: TokenStore

  constructor(config: YouTubeAPIConfig) {
    this.tokenStore = config.tokenStore

    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
    )

    // Set tokens from store
    const tokens = this.tokenStore.getTokens()
    if (tokens) {
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })
    }

    // Initialize YouTube API
    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client,
    })

    // Handle token refresh
    this.oauth2Client.on('tokens', async (tokens) => {
      log.log('Tokens refreshed by Google client')
      const currentTokens = this.tokenStore.getTokens()
      if (currentTokens) {
        await this.tokenStore.setTokens({
          ...currentTokens,
          accessToken: tokens.access_token || currentTokens.accessToken,
          refreshToken: tokens.refresh_token || currentTokens.refreshToken,
          expiresAt: tokens.expiry_date || undefined,
        })
      }
    })
  }

  /**
   * Extract video ID from various YouTube URL formats
   */
  extractVideoId(url: string): string | null {
    const patterns = [
      // Standard watch URL: https://www.youtube.com/watch?v=VIDEO_ID
      /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      // Short URL: https://youtu.be/VIDEO_ID
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      // Live URL: https://www.youtube.com/live/VIDEO_ID
      /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
      // Embed URL: https://www.youtube.com/embed/VIDEO_ID
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match && match[1]) {
        return match[1]
      }
    }

    // Maybe it's just the video ID itself
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url
    }

    return null
  }

  /**
   * Get the live chat ID for a video
   */
  async getLiveChatId(videoId: string): Promise<string | null> {
    try {
      const response = await this.youtube.videos.list({
        part: ['liveStreamingDetails'],
        id: [videoId],
      })

      const video = response.data.items?.[0]
      if (!video) {
        log.error('Video not found:', videoId)
        return null
      }

      const liveChatId = video.liveStreamingDetails?.activeLiveChatId
      if (!liveChatId) {
        log.error('No active live chat for video:', videoId)
        return null
      }

      return liveChatId
    }
    catch (error) {
      log.withError(error).error('Failed to get live chat ID')
      throw error
    }
  }

  /**
   * Get live chat messages
   */
  async getLiveChatMessages(
    liveChatId: string,
    pageToken?: string,
  ): Promise<{
    messages: LiveChatMessage[]
    nextPageToken?: string
    pollingIntervalMillis: number
  }> {
    try {
      const response = await this.youtube.liveChatMessages.list({
        liveChatId,
        part: ['snippet', 'authorDetails'],
        pageToken,
      })

      const messages: LiveChatMessage[] = (response.data.items || []).map((item) => {
        const snippet = item.snippet!
        const authorDetails = item.authorDetails!

        return {
          id: item.id!,
          authorDisplayName: authorDetails.displayName!,
          authorChannelId: authorDetails.channelId!,
          messageText: snippet.displayMessage || '',
          publishedAt: snippet.publishedAt!,
          superChatDetails: snippet.superChatDetails ? {
            amountDisplayString: snippet.superChatDetails.amountDisplayString!,
            amountMicros: snippet.superChatDetails.amountMicros!,
            currency: snippet.superChatDetails.currency!,
            tier: snippet.superChatDetails.tier!,
            userComment: snippet.superChatDetails.userComment || undefined,
          } : undefined,
          superStickerDetails: snippet.superStickerDetails ? {
            amountDisplayString: snippet.superStickerDetails.amountDisplayString!,
            amountMicros: snippet.superStickerDetails.amountMicros!,
            currency: snippet.superStickerDetails.currency!,
            tier: snippet.superStickerDetails.tier!,
            superStickerMetadata: snippet.superStickerDetails.superStickerMetadata ? {
              stickerId: snippet.superStickerDetails.superStickerMetadata.stickerId!,
              altText: snippet.superStickerDetails.superStickerMetadata.altText!,
              language: snippet.superStickerDetails.superStickerMetadata.language!,
            } : undefined,
          } : undefined,
        }
      })

      return {
        messages,
        nextPageToken: response.data.nextPageToken || undefined,
        pollingIntervalMillis: response.data.pollingIntervalMillis || 5000,
      }
    }
    catch (error) {
      log.withError(error).error('Failed to get live chat messages')
      throw error
    }
  }
}
