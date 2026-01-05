import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a cryptographically random code verifier for PKCE
 * The verifier should be between 43-128 characters
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url')
}

/**
 * Generate a state parameter for OAuth
 */
export function generateState(): string {
  return randomBytes(16).toString('base64url')
}
