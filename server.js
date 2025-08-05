const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Spotify API Configuration - Using environment variables from Vercel
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Check if credentials are available
if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing Spotify credentials. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables.');
    console.log('ℹ️  For local development, you can set them in your shell:');
    console.log('   export SPOTIFY_CLIENT_ID=your_client_id');
    console.log('   export SPOTIFY_CLIENT_SECRET=your_client_secret');
}

let spotifyAccessToken = '';
let tokenExpiryTime = 0;

// Get Spotify Access Token
async function getSpotifyToken() {
    // Check if token is still valid (with 5 minute buffer)
    if (spotifyAccessToken && Date.now() < tokenExpiryTime - 300000) {
        return spotifyAccessToken;
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            },
            body: 'grant_type=client_credentials'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        spotifyAccessToken = data.access_token;
        tokenExpiryTime = Date.now() + (data.expires_in * 1000);
        
        console.log('New Spotify token obtained, expires in:', data.expires_in, 'seconds');
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify token:', error);
        throw error;
    }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Corriente Sound API is running' });
});

// Authenticate with Spotify
app.post('/api/auth', async (req, res) => {
    try {
        const token = await getSpotifyToken();
        res.json({ success: true, message: 'Authenticated successfully' });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to authenticate with Spotify' 
        });
    }
});

// Search for songs
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'Query parameter required' });
        }

        const token = await getSpotifyToken();
        
        const response = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Spotify API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data.tracks.items);
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get audio features for a track
app.get('/api/audio-features/:trackId', async (req, res) => {
    try {
        const { trackId } = req.params;
        const token = await getSpotifyToken();
        
        const response = await fetch(
            `https://api.spotify.com/v1/audio-features/${trackId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Spotify API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
        
    } catch (error) {
        console.error('Audio features error:', error);
        res.status(500).json({ error: 'Failed to get audio features' });
    }
});

// Get recommendations
app.get('/api/recommendations', async (req, res) => {
    try {
        const token = await getSpotifyToken();
        
        // Build query string from all request parameters
        const queryParams = new URLSearchParams(req.query);
        
        const response = await fetch(
            `https://api.spotify.com/v1/recommendations?${queryParams}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Spotify API error: ${response.status}`);
        }

        const data = await response.json();
        res.json(data.tracks);
        
    } catch (error) {
        console.error('Recommendations error:', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    console.log('Serving HTML from:', htmlPath);
    
    // Check if file exists, if not serve a simple response
    const fs = require('fs');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.send(`
            <h1>Corriente Sound Backend is Running!</h1>
            <p>Backend API is working, but index.html not found.</p>
            <p>Make sure index.html is in the public/ folder.</p>
            <p>API endpoints:</p>
            <ul>
                <li><a href="/api/health">/api/health</a></li>
                <li>POST /api/auth</li>
                <li>GET /api/search?q=query</li>
            </ul>
        `);
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎵 Corriente Sound server running on http://localhost:${PORT}`);
    console.log(`🔗 Frontend available at http://localhost:${PORT}`);
    
    // Test Spotify connection on startup
    getSpotifyToken()
        .then(() => console.log('✅ Spotify API connection successful'))
        .catch(err => console.error('❌ Spotify API connection failed:', err.message));
});
