import { createApp, createRouter, defineEventHandler, getQuery } from 'h3'
import { listen, type Listener } from 'listhen'
import open from 'open'

import { useLogg } from '@guiiai/logg'

import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import type { TokenStore } from './token-store'

const log = useLogg('OAuthServer')

const OAUTH_PORT = 17845
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}/oauth/google/callback`
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly']

export interface OAuthServerConfig {
  clientId: string
  clientSecret: string
  tokenStore: TokenStore
  port?: number
}

export class OAuthServer {
  private app = createApp()
  private listener: Listener | null = null
  private clientId: string
  private clientSecret: string
  private tokenStore: TokenStore
  private port: number

  // PKCE state
  private codeVerifier: string | null = null
  private state: string | null = null
  private authResolve: ((value: boolean) => void) | null = null

  constructor(config: OAuthServerConfig) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.tokenStore = config.tokenStore
    this.port = config.port || OAUTH_PORT

    this.setupRoutes()
  }

  updateCredentials(clientId: string, clientSecret: string): void {
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  private setupRoutes(): void {
    const router = createRouter()

    // OAuth callback handler
    router.get('/oauth/google/callback', defineEventHandler(async (event) => {
      const query = getQuery(event)
      const { code, state, error } = query as { code?: string, state?: string, error?: string }

      if (error) {
        log.error('OAuth error:', error)
        this.authResolve?.(false)
        return 'Authentication failed. You can close this window.'
      }

      if (!code || !state) {
        log.error('Missing code or state in callback')
        this.authResolve?.(false)
        return 'Invalid callback. You can close this window.'
      }

      // Verify state
      if (state !== this.state) {
        log.error('State mismatch')
        this.authResolve?.(false)
        return 'Security error: state mismatch. You can close this window.'
      }

      try {
        // Exchange code for tokens
        await this.exchangeCodeForTokens(code)
        log.log('Successfully authenticated with Google')
        this.authResolve?.(true)
        return 'Authentication successful! You can close this window and return to AIRI.'
      }
      catch (err) {
        log.withError(err).error('Failed to exchange code for tokens')
        this.authResolve?.(false)
        return 'Authentication failed. You can close this window.'
      }
    }))

    // Health check
    router.get('/health', defineEventHandler(() => ({ status: 'ok' })))

    this.app.use(router)
  }

  private async exchangeCodeForTokens(code: string): Promise<void> {
    if (!this.codeVerifier) {
      throw new Error('No code verifier available')
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      code_verifier: this.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    })

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token exchange failed: ${errorText}`)
    }

    const data = await response.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    }

    await this.tokenStore.setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
      tokenType: data.token_type,
    })

    // Clear PKCE state
    this.codeVerifier = null
    this.state = null
  }

  async refreshAccessToken(): Promise<boolean> {
    const tokens = this.tokenStore.getTokens()
    if (!tokens?.refreshToken) {
      log.warn('No refresh token available')
      return false
    }

    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      })

      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token refresh failed: ${errorText}`)
      }

      const data = await response.json() as {
        access_token: string
        expires_in?: number
        scope?: string
        token_type?: string
      }

      await this.tokenStore.setTokens({
        ...tokens,
        accessToken: data.access_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        scope: data.scope,
        tokenType: data.token_type,
      })

      log.log('Successfully refreshed access token')
      return true
    }
    catch (error) {
      log.withError(error).error('Failed to refresh access token')
      return false
    }
  }

  async startAuthFlow(): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) {
      log.error('Client ID and Secret are required for OAuth')
      return false
    }

    // Generate PKCE values
    this.codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(this.codeVerifier)
    this.state = generateState()

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state: this.state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    })

    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`

    log.log('Opening browser for authentication...')
    log.log('Auth URL:', authUrl)

    // Open browser
    try {
      await open(authUrl)
    }
    catch (error) {
      log.withError(error).error('Failed to open browser')
      log.log('Please open the following URL manually:', authUrl)
    }

    // Wait for callback
    return new Promise((resolve) => {
      this.authResolve = resolve
      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.authResolve === resolve) {
          log.warn('Authentication timed out')
          this.authResolve = null
          resolve(false)
        }
      }, 5 * 60 * 1000)
    })
  }

  async start(): Promise<void> {
    if (this.listener) {
      return
    }

    try {
      this.listener = await listen(this.app, {
        port: this.port,
        showURL: false,
      })
      log.log(`OAuth callback server listening on port ${this.port}`)
    }
    catch (error) {
      log.withError(error).error('Failed to start OAuth server')
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.listener) {
      await this.listener.close()
      this.listener = null
      log.log('OAuth server stopped')
    }
  }
}
