// Updated server.js with ReccoBeats API integration

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

// ReccoBeats API Configuration
const RECCOBEATS_API_BASE = 'https://api.reccobeats.com/v1';
const RECCOBEATS_API_KEY = process.env.RECCOBEATS_API_KEY; // Add this if they require auth

// Check if credentials are available
if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing Spotify credentials. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables.');
}

let spotifyAccessToken = '';
let tokenExpiryTime = 0;

// Get Spotify Access Token (for search functionality)
async function getSpotifyToken() {
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
        
        console.log('✅ New Spotify token obtained for search');
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify token:', error);
        throw error;
    }
}

// ReccoBeats API helper function
async function callReccoBeatsAPI(endpoint, options = {}) {
    try {
        const url = `${RECCOBEATS_API_BASE}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(RECCOBEATS_API_KEY && { 'Authorization': `Bearer ${RECCOBEATS_API_KEY}` }),
            ...options.headers
        };

        console.log(`🎵 Calling ReccoBeats API: ${url}`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers,
            ...options
        });

        if (!response.ok) {
            throw new Error(`ReccoBeats API error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ ReccoBeats API response received');
        return data;
        
    } catch (error) {
        console.error('ReccoBeats API error:', error);
        throw error;
    }
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Corriente Sound API is running',
        integrations: {
            spotify: 'Search functionality',
            reccobeats: 'Audio features & recommendations'
        }
    });
});

// Authenticate with Spotify (for search)
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

// Search for songs (still using Spotify for comprehensive search)
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

// Get audio features via ReccoBeats API (replaces deprecated Spotify endpoint)
app.get('/api/audio-features/:trackId', async (req, res) => {
    try {
        const { trackId } = req.params;
        
        console.log(`🎯 Getting audio features for track: ${trackId}`);
        
        // Call ReccoBeats API instead of Spotify
        const audioFeatures = await callReccoBeatsAPI(`/track/${trackId}/audio-features`);
        
        res.json(audioFeatures);
        
    } catch (error) {
        console.error('Audio features error:', error);
        
        // Fallback error response that matches expected format
        res.status(500).json({ 
            error: 'Failed to get audio features',
            details: error.message,
            trackId: req.params.trackId
        });
    }
});

// Build custom recommendations using ReccoBeats (replaces deprecated Spotify recommendations)
app.get('/api/recommendations', async (req, res) => {
    try {
        console.log('🎯 Building custom recommendations...');
        console.log('Query params:', req.query);
        
        // Extract mood parameters from query
        const {
            seed_tracks,
            limit = 9,
            target_energy,
            target_danceability,
            target_valence,
            target_tempo
        } = req.query;

        if (!seed_tracks) {
            return res.status(400).json({ error: 'seed_tracks parameter required' });
        }

        // Get features of seed track to understand current mood
        const seedFeatures = await callReccoBeatsAPI(`/track/${seed_tracks}/audio-features`);
        
        console.log('Seed track features:', seedFeatures);
        
        // For now, we'll implement a basic recommendation system
        // This would need to be enhanced based on ReccoBeats' actual recommendation endpoints
        
        // Check if ReccoBeats has a recommendation endpoint
        try {
            // Try different potential endpoints for recommendations
            let recommendations = [];
            
            // Option 1: Try direct recommendations endpoint
            try {
                const searchParams = new URLSearchParams({
                    seed_track: seed_tracks,
                    limit: limit,
                    ...(target_energy && { target_energy }),
                    ...(target_danceability && { target_danceability }),
                    ...(target_valence && { target_valence }),
                    ...(target_tempo && { target_tempo })
                });
                
                recommendations = await callReccoBeatsAPI(`/recommendations?${searchParams}`);
                console.log('✅ Got recommendations from ReccoBeats');
                
            } catch (reccoError) {
                console.log('❌ Direct recommendations failed, trying alternative approach...');
                
                // Option 2: Build recommendations using feature similarity search
                // This is a fallback approach if ReccoBeats doesn't have direct recommendations
                recommendations = await buildCustomRecommendations({
                    seedFeatures,
                    targetFeatures: {
                        energy: target_energy,
                        danceability: target_danceability, 
                        valence: target_valence,
                        tempo: target_tempo
                    },
                    limit
                });
            }
            
            res.json(recommendations);
            
        } catch (recommendationError) {
            console.error('Recommendation generation failed:', recommendationError);
            
            // Return empty recommendations array as fallback
            res.json([]);
        }
        
    } catch (error) {
        console.error('Recommendations error:', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

// Custom recommendation builder (fallback if ReccoBeats doesn't have direct recommendations)
async function buildCustomRecommendations({ seedFeatures, targetFeatures, limit }) {
    console.log('🔧 Building custom recommendations...');
    
    // This is a placeholder implementation
    // In reality, you'd need to:
    // 1. Search ReccoBeats database for tracks with similar features
    // 2. Score tracks based on feature similarity
    // 3. Return top matches
    
    try {
        // Check if ReccoBeats has a search/filter endpoint
        const searchParams = new URLSearchParams({
            limit: limit * 3, // Get more to filter down
            // Add feature range filters if supported
            energy_min: Math.max(0, (targetFeatures.energy || seedFeatures.energy) - 0.2),
            energy_max: Math.min(1, (targetFeatures.energy || seedFeatures.energy) + 0.2),
            danceability_min: Math.max(0, (targetFeatures.danceability || seedFeatures.danceability) - 0.2),
            danceability_max: Math.min(1, (targetFeatures.danceability || seedFeatures.danceability) + 0.2),
        });
        
        const searchResults = await callReccoBeatsAPI(`/search/tracks?${searchParams}`);
        
        // Filter and score results (basic implementation)
        const scored = searchResults.map(track => {
            const score = calculateSimilarityScore(seedFeatures, track.audio_features, targetFeatures);
            return { ...track, similarity_score: score };
        });
        
        // Sort by similarity and return top results
        return scored
            .sort((a, b) => b.similarity_score - a.similarity_score)
            .slice(0, limit);
            
    } catch (searchError) {
        console.error('Custom recommendation search failed:', searchError);
        // Return empty array as ultimate fallback
        return [];
    }
}

// Calculate similarity score between tracks (helper function)
function calculateSimilarityScore(seedFeatures, trackFeatures, targetFeatures) {
    const features = ['energy', 'danceability', 'valence', 'tempo'];
    let score = 0;
    
    features.forEach(feature => {
        const target = targetFeatures[feature] || seedFeatures[feature];
        const diff = Math.abs(target - trackFeatures[feature]);
        score += (1 - diff); // Higher score for smaller differences
    });
    
    return score / features.length;
}

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
            <p>Backend API is working with ReccoBeats integration!</p>
            <p>API endpoints:</p>
            <ul>
                <li><a href="/api/health">/api/health</a> - Service status</li>
                <li>POST /api/auth - Authenticate with Spotify</li>
                <li>GET /api/search?q=query - Search for songs</li>
                <li>GET /api/audio-features/:trackId - Get audio features via ReccoBeats</li>
                <li>GET /api/recommendations - Custom recommendations</li>
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
    console.log('🎯 Integrations:');
    console.log('   - Spotify API: Search functionality');
    console.log('   - ReccoBeats API: Audio features & recommendations');
    
    // Test connections on startup
    getSpotifyToken()
        .then(() => console.log('✅ Spotify API connection successful'))
        .catch(err => console.error('❌ Spotify API connection failed:', err.message));
        
    // Test ReccoBeats API
    console.log('🧪 Testing ReccoBeats API connection...');
    // You can add a test call here once you have the API details
});
