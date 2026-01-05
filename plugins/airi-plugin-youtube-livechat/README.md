# @proj-airi/airi-plugin-youtube-livechat

YouTube Live Chat integration plugin for AIRI. Reads live chat messages from YouTube streams and sends them as `input:text` events to AIRI.

## Features

- Real-time live chat polling from YouTube streams
- Super Chat and Super Sticker support with amount display
- OAuth 2.0 + PKCE authentication flow
- Automatic token refresh
- Duplicate message filtering
- Exponential backoff on errors

## Setup

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable **YouTube Data API v3**:
   - Go to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"
4. Configure OAuth consent screen:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Select "External" user type
   - Fill in app name, email, and developer contact info
   - Add scope: `https://www.googleapis.com/auth/youtube.readonly`
   - Add your Google account as a test user
5. Create OAuth credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "+ Create Credentials" > "OAuth client ID"
   - Select **"Desktop app"** as application type
   - Give it a name and click "Create"
   - Save the **Client ID** and **Client Secret**

### 2. Environment Variables

Create a `.env` file in the plugin directory:

```env
# Google OAuth credentials
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here

# YouTube stream URL (optional - can be set at runtime)
YOUTUBE_STREAM_URL=https://www.youtube.com/watch?v=VIDEO_ID

# AIRI server connection (optional - defaults to localhost:6121)
AIRI_URL=ws://localhost:6121/ws
AIRI_TOKEN=your_airi_token_if_required
```

### 3. Running the Plugin

```bash
# Install dependencies
pnpm install

# Start the plugin
pnpm start
```

On first run, a browser window will open for Google OAuth authentication. After authenticating, the plugin will automatically start polling the specified YouTube live chat.

## Message Format

Messages are sent to AIRI as `input:text` events with the following formats:

- **Normal message**: `"{author}: {message}"`
- **Super Chat**: `"[SUPERCHAT {amount}] {author}: {message}"`
- **Super Sticker**: `"[SUPERSTICKER {amount}] {author}"`

## Configuration

The plugin can be configured at runtime via `module:configure` events:

```typescript
{
  enabled: boolean,      // Enable/disable the plugin
  clientId: string,      // Google OAuth Client ID
  clientSecret: string,  // Google OAuth Client Secret
  streamUrl: string,     // YouTube stream URL
  startOAuth: boolean,   // Trigger OAuth flow
}
```

## API Quotas

YouTube Data API v3 has a default quota of 10,000 units per day. The `liveChatMessages.list` call costs approximately 5 units per request. The plugin respects the `pollingIntervalMillis` returned by the API to minimize quota usage.

## License

MIT
