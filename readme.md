# Corriente Sound - Spotify Playlist Generator

A mood-based playlist generator that starts with a song you love and creates playlists based on mood directions.

## 🚀 Quick Setup

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy `.env.example` to `.env`
   - Add your Spotify API credentials (get them from [Spotify Developer Dashboard](https://developer.spotify.com/dashboard))

3. **Create folder structure:**
   ```
   project/
   ├── server.js
   ├── package.json
   ├── .env
   ├── vercel.json
   └── public/
       └── index.html
   ```

4. **Move your HTML file:**
   - Create a `public/` folder
   - Move `index.html` into the `public/` folder

5. **Start the server:**
   ```bash
   npm run dev
   ```

6. **Open browser:**
   - Go to `http://localhost:3001`

### Vercel Deployment

1. **Prepare files:**
   - Ensure folder structure is correct (HTML file in `public/` folder)
   - Make sure `vercel.json` is in root directory

2. **Deploy to Vercel:**
   - Install Vercel CLI: `npm i -g vercel`
   - Run: `vercel`
   - Follow prompts

3. **Set environment variables in Vercel:**
   - Go to your Vercel dashboard
   - Click on your project
   - Go to Settings → Environment Variables
   - Add:
     - `SPOTIFY_CLIENT_ID` = your client ID
     - `SPOTIFY_CLIENT_SECRET` = your client secret

4. **Update Spotify Redirect URI:**
   - In Spotify Developer Dashboard
   - Add your Vercel URL to Redirect URIs: `https://your-app.vercel.app`

## 🔧 What This Fixes

- ✅ **CORS Issues**: Backend proxy handles all Spotify API calls
- ✅ **Security**: Client secret stays on server, not exposed in browser
- ✅ **Authentication**: Proper token management with automatic refresh
- ✅ **Error Handling**: Better error messages and retry logic
- ✅ **Performance**: Token caching and reuse

## 📁 File Structure

```
corriente-sound/
├── server.js              # Express backend proxy
├── package.json           # Dependencies
├── .env                   # Environment variables (local)
├── vercel.json           # Vercel configuration
└── public/
    └── index.html         # Your frontend app
```

## 🎵 How It Works

1. **Frontend** makes requests to your backend (`/api/...`)
2. **Backend** handles authentication and proxies requests to Spotify
3. **Spotify API** returns data to backend
4. **Backend** sends clean data back to frontend
5. **Frontend** displays results and handles audio playback

## 🔍 API Endpoints

- `POST /api/auth` - Authenticate with Spotify
- `GET /api/search?q=query` - Search for songs
- `GET /api/audio-features/:trackId` - Get song audio features
- `GET /api/recommendations?params` - Get song recommendations

## 🐛 Troubleshooting

- **CORS errors**: Make sure backend is running and frontend is calling correct API_BASE
- **Auth errors**: Check Spotify credentials in environment variables
- **No audio**: Some songs don't have preview URLs available
- **Search not working**: Verify authentication completed successfully