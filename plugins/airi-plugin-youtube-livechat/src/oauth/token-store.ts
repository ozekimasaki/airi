import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'

const log = useLogg('TokenStore')

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
}

export class TokenStore {
  private tokens: OAuthTokens | null = null
  private tokenFilePath: string

  constructor(tokenFilePath?: string) {
    // Default to storing in user's home directory or current directory
    const dataDir = env.AIRI_DATA_DIR || join(process.cwd(), '.airi-data')
    this.tokenFilePath = tokenFilePath || join(dataDir, 'youtube-tokens.json')
  }

  getTokens(): OAuthTokens | null {
    return this.tokens
  }

  async setTokens(tokens: OAuthTokens): Promise<void> {
    this.tokens = tokens
    await this.save()
  }

  isTokenValid(): boolean {
    if (!this.tokens)
      return false

    if (this.tokens.expiresAt) {
      // Consider token invalid if it expires within 5 minutes
      const bufferMs = 5 * 60 * 1000
      return Date.now() < this.tokens.expiresAt - bufferMs
    }

    // If no expiry info, assume valid
    return true
  }

  async load(): Promise<void> {
    try {
      const data = await readFile(this.tokenFilePath, 'utf-8')
      this.tokens = JSON.parse(data) as OAuthTokens
      log.log('Loaded tokens from file')
    }
    catch {
      log.log('No existing tokens found')
      this.tokens = null
    }
  }

  async save(): Promise<void> {
    if (!this.tokens)
      return

    try {
      // Ensure directory exists
      await mkdir(dirname(this.tokenFilePath), { recursive: true })
      await writeFile(this.tokenFilePath, JSON.stringify(this.tokens, null, 2))
      log.log('Saved tokens to file')
    }
    catch (error) {
      log.withError(error).error('Failed to save tokens')
    }
  }

  async clear(): Promise<void> {
    this.tokens = null
    try {
      await unlink(this.tokenFilePath)
      log.log('Cleared tokens')
    }
    catch {
      // File may not exist, ignore
    }
  }
}
