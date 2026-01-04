import type { LiveChatMessage } from './api'

/**
 * Format a live chat message for AIRI input
 *
 * Formats:
 * - Normal message: "{author}: {message}"
 * - Super Chat: "[SUPERCHAT {amount}] {author}: {message}"
 * - Super Sticker: "[SUPERSTICKER {amount}] {author}"
 */
export function formatChatMessage(message: LiveChatMessage): string {
  const author = message.authorDisplayName

  // Super Chat
  if (message.superChatDetails) {
    const amount = message.superChatDetails.amountDisplayString
    const text = message.superChatDetails.userComment || message.messageText
    if (text) {
      return `[SUPERCHAT ${amount}] ${author}: ${text}`
    }
    return `[SUPERCHAT ${amount}] ${author}`
  }

  // Super Sticker
  if (message.superStickerDetails) {
    const amount = message.superStickerDetails.amountDisplayString
    const altText = message.superStickerDetails.superStickerMetadata?.altText
    if (altText) {
      return `[SUPERSTICKER ${amount}] ${author}: ${altText}`
    }
    return `[SUPERSTICKER ${amount}] ${author}`
  }

  // Normal message
  return `${author}: ${message.messageText}`
}
