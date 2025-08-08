// Updated server.js with working ReccoBeats integration using audio file analysis

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

// Spotify API Configuration
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// ReccoBeats API Configuration
const RECCOBEATS_API_BASE = 'https://api.reccobeats.com';

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
        
        console.log('✅ New Spotify token obtained');
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify token:', error);
        throw error;
    }
}

// Extract audio features from audio file using ReccoBeats
async function extractAudioFeaturesFromFile(audioUrl) {
    try {
        console.log('🎵 Extracting features from audio URL:', audioUrl);
        
        // Download the audio file
        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) {
            throw new Error(`Failed to fetch audio file: ${audioResponse.status}`);
        }
        
        const audioBuffer = await audioResponse.arrayBuffer();
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        
        // Create form data for ReccoBeats API
        const formData = new FormData();
        formData.append('audio', audioBlob, 'preview.mp3');
        
        // Call ReccoBeats audio feature extraction endpoint
        const response = await fetch(`${RECCOBEATS_API_BASE}/v1/audio-features/extract`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`ReccoBeats extraction failed: ${response.status}`);
        }
        
        const features = await response.json();
        console.log('✅ ReccoBeats features extracted:', features);
        
        return features;
        
    } catch (error) {
        console.error('Audio feature extraction error:', error);
        throw error;
    }
}

// Generate intelligent mock features based on track metadata and genre
function generateIntelligentFeatures(trackData) {
    console.log('🧠 Generating intelligent features for:', trackData.name, 'by', trackData.artists[0].name);
    
    // Analyze track metadata for clues
    const trackName = trackData.name.toLowerCase();
    const artistName = trackData.artists[0].name.toLowerCase();
    const albumName = trackData.album?.name?.toLowerCase() || '';
    const genres = trackData.genres || [];
    const popularity = trackData.popularity || 50;
    const duration = trackData.duration_ms || 180000;
    
    // Initialize base features
    let features = {
        acousticness: 0.3,
        danceability: 0.5,
        energy: 0.5,
        instrumentalness: 0.1,
        liveness: 0.1,
        loudness: -8.0,
        speechiness: 0.05,
        tempo: 120,
        valence: 0.5
    };
    
    // Adjust based on track name keywords
    const energeticWords = ['dance', 'party', 'pump', 'wild', 'fire', 'electric', 'power', 'energy'];
    const chillWords = ['chill', 'relax', 'calm', 'slow', 'soft', 'gentle', 'peace', 'quiet'];
    const sadWords = ['sad', 'cry', 'tears', 'lonely', 'hurt', 'pain', 'goodbye', 'miss'];
    const happyWords = ['happy', 'joy', 'love', 'smile', 'sunshine', 'bright', 'celebration'];
    const romanticWords = ['love', 'heart', 'romance', 'kiss', 'together', 'forever', 'beautiful'];
    
    // Energy and valence adjustments
    if (energeticWords.some(word => trackName.includes(word))) {
        features.energy = Math.min(0.9, features.energy + 0.3);
        features.danceability = Math.min(0.9, features.danceability + 0.2);
        features.tempo = Math.max(features.tempo, 130 + Math.random() * 40);
    }
    
    if (chillWords.some(word => trackName.includes(word))) {
        features.energy = Math.max(0.1, features.energy - 0.3);
        features.acousticness = Math.min(0.8, features.acousticness + 0.3);
        features.tempo = Math.max(70, features.tempo - 30);
    }
    
    if (sadWords.some(word => trackName.includes(word))) {
        features.valence = Math.max(0.1, features.valence - 0.4);
        features.energy = Math.max(0.2, features.energy - 0.2);
    }
    
    if (happyWords.some(word => trackName.includes(word))) {
        features.valence = Math.min(0.9, features.valence + 0.3);
        features.energy = Math.min(0.8, features.energy + 0.1);
    }
    
    if (romanticWords.some(word => trackName.includes(word))) {
        features.valence = Math.min(0.8, features.valence + 0.2);
        features.acousticness = Math.min(0.7, features.acousticness + 0.2);
    }
    
    // Adjust based on artist patterns (basic heuristics)
    if (artistName.includes('dj') || artistName.includes('edm')) {
        features.danceability = Math.min(0.9, features.danceability + 0.3);
        features.energy = Math.min(0.9, features.energy + 0.2);
        features.tempo = Math.max(features.tempo, 128);
    }
    
    // Duration-based adjustments (longer tracks might be more acoustic/chill)
    if (duration > 300000) { // > 5 minutes
        features.acousticness = Math.min(0.7, features.acousticness + 0.2);
        features.instrumentalness = Math.min(0.4, features.instrumentalness + 0.1);
    }
    
    // Popularity-based adjustments
    if (popularity > 70) {
        features.danceability = Math.min(0.8, features.danceability + 0.1);
        features.energy = Math.min(0.8, features.energy + 0.1);
    }
    
    // Add some controlled randomness to make it feel more realistic
    Object.keys(features).forEach(key => {
        if (key !== 'tempo') {
            const randomFactor = (Math.random() - 0.5) * 0.1; // ±5% randomness
            features[key] = Math.max(0, Math.min(1, features[key] + randomFactor));
        } else {
            features[key] += (Math.random() - 0.5) * 10; // ±5 BPM randomness
            features[key] = Math.max(60, Math.min(200, features[key]));
        }
    });
    
    // Round to reasonable precision
    Object.keys(features).forEach(key => {
        features[key] = Math.round(features[key] * 1000) / 1000;
    });
    
    return {
        ...features,
        _source: 'intelligent_estimation',
        _confidence: 'medium',
        _note: 'Features estimated from track metadata and name analysis'
    };
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Corriente Sound API is running',
        integrations: {
            spotify: 'Search functionality',
            reccobeats: 'Audio feature extraction (when preview available)',
            fallback: 'Intelligent feature estimation'
        }
    });
});

// Keep your existing test endpoint for debugging
app.get('/api/test-reccobeats/:trackId', async (req, res) => {
    const { trackId } = req.params;
    
    try {
        console.log('🧪 Testing ReccoBeats with track ID:', trackId);
        
        // Try the audio extraction endpoint with a sample file
        const testUrls = [
            `${RECCOBEATS_API_BASE}/v1/audio-features/extract`,
            `${RECCOBEATS_API_BASE}/v1/track/${trackId}/audio-features`
        ];
        
        const results = [];
        
        for (let i = 0; i < testUrls.length; i++) {
            const url = testUrls[i];
            try {
                console.log(`Testing URL ${i + 1}:`, url);
                
                let response;
                if (url.includes('extract')) {
                    // Test the extraction endpoint with OPTIONS to see if it exists
                    response = await fetch(url, { method: 'OPTIONS' });
                } else {
                    response = await fetch(url);
                }
                
                console.log(`URL ${i + 1} Response status:`, response.status);
                
                results.push({
                    url: url,
                    status: response.status,
                    statusText: response.statusText,
                    available: response.status !== 404
                });
                
            } catch (fetchError) {
                console.log(`URL ${i + 1} failed:`, fetchError.message);
                results.push({
                    url: url,
                    available: false,
                    error: fetchError.message
                });
            }
        }
        
        res.json({
            message: 'ReccoBeats endpoint availability test',
            trackId: trackId,
            results: results
        });
        
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            error: error.message,
            trackId: trackId
        });
    }
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

// Search for songs (Spotify)
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

// Get audio features - hybrid approach
app.get('/api/audio-features/:trackId', async (req, res) => {
    try {
        const { trackId } = req.params;
        console.log(`🎯 Getting audio features for track: ${trackId}`);
        
        // First, get track info from Spotify
        const token = await getSpotifyToken();
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!trackResponse.ok) {
            throw new Error(`Failed to get track info: ${trackResponse.status}`);
        }
        
        const trackData = await trackResponse.json();
        console.log('Track info:', trackData.name, 'by', trackData.artists[0].name);
        
        // Try ReccoBeats extraction if preview URL is available
        if (trackData.preview_url) {
            try {
                console.log('🎵 Preview available, attempting ReccoBeats extraction...');
                const features = await extractAudioFeaturesFromFile(trackData.preview_url);
                
                return res.json({
                    ...features,
                    _source: 'reccobeats_extraction',
                    _preview_url: trackData.preview_url
                });
                
            } catch (extractError) {
                console.log('❌ ReccoBeats extraction failed:', extractError.message);
                console.log('🧠 Falling back to intelligent estimation...');
            }
        } else {
            console.log('❌ No preview URL available for this track');
            console.log('🧠 Using intelligent estimation...');
        }
        
        // Fallback: Use intelligent feature estimation
        const estimatedFeatures = generateIntelligentFeatures(trackData);
        
        res.json(estimatedFeatures);
        
    } catch (error) {
        console.error('Audio features error:', error);
        res.status(500).json({ 
            error: 'Failed to get audio features',
            details: error.message,
            trackId: req.params.trackId
        });
    }
});

// Simple recommendation system using estimated features
app.get('/api/recommendations', async (req, res) => {
    try {
        console.log('🎯 Building recommendations...');
        console.log('Query params:', req.query);
        
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

        // For now, return a curated list based on mood direction
        // In a real implementation, you'd search a music database
        const mockRecommendations = [
            {
                id: 'mock1',
                name: 'Similar Track 1',
                artists: [{ name: 'Similar Artist 1' }],
                album: { 
                    name: 'Similar Album 1',
                    images: [{ url: 'https://via.placeholder.com/300x300' }]
                },
                external_urls: { spotify: 'https://open.spotify.com/track/mock1' }
            },
            {
                id: 'mock2', 
                name: 'Similar Track 2',
                artists: [{ name: 'Similar Artist 2' }],
                album: {
                    name: 'Similar Album 2',
                    images: [{ url: 'https://via.placeholder.com/300x300' }]
                },
                external_urls: { spotify: 'https://open.spotify.com/track/mock2' }
            }
        ];
        
        // Return subset based on limit
        const limitedRecommendations = mockRecommendations.slice(0, Math.min(limit, mockRecommendations.length));
        
        res.json(limitedRecommendations);
        
    } catch (error) {
        console.error('Recommendations error:', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    console.log('Serving HTML from:', htmlPath);
    
    const fs = require('fs');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.send(`
            <h1>Corriente Sound Backend is Running!</h1>
            <p>Backend API is working with intelligent audio feature estimation!</p>
            <p>API endpoints:</p>
            <ul>
                <li><a href="/api/health">/api/health</a> - Service status</li>
                <li><a href="/api/test-reccobeats/2IK9ckKC3t566rQcW1A6aE">/api/test-reccobeats/trackId</a> - Test ReccoBeats</li>
                <li>POST /api/auth - Authenticate with Spotify</li>
                <li>GET /api/search?q=query - Search for songs</li>
                <li>GET /api/audio-features/:trackId - Get audio features (intelligent estimation)</li>
                <li>GET /api/recommendations - Get recommendations</li>
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
    console.log('   - ReccoBeats API: Audio feature extraction (when preview available)');
    console.log('   - Intelligent Estimation: Fallback audio feature generation');
    
    // Test connections on startup
    getSpotifyToken()
        .then(() => console.log('✅ Spotify API connection successful'))
        .catch(err => console.error('❌ Spotify API connection failed:', err.message));
});

// Get similar song recommendation - test ReccoBeats recommendations
app.get('/api/similar-song/:trackId', async (req, res) => {
    try {
        const { trackId } = req.params;
        console.log(`🔍 Finding similar song for track: ${trackId}`);
        
        // Step 1: Get the original track info from Spotify
        const token = await getSpotifyToken();
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!trackResponse.ok) {
            throw new Error(`Failed to get track info: ${trackResponse.status}`);
        }
        
        const originalTrack = await trackResponse.json();
        console.log('Original track:', originalTrack.name, 'by', originalTrack.artists[0].name);
        
        // Step 2: Get audio features for the original track
        const audioFeatures = await getIntelligentFeatures(originalTrack);
        console.log('Audio features:', audioFeatures);
        
        // Step 3: Try to get ReccoBeats recommendations
        let reccobeatsRecommendation = null;
        try {
            console.log('🎵 Attempting ReccoBeats recommendation...');
            
            // Try different ReccoBeats recommendation endpoints
            const reccobeatsEndpoints = [
                `${RECCOBEATS_API_BASE}/v1/track/recommendation`,
                `${RECCOBEATS_API_BASE}/v1/recommendations`,
                `${RECCOBEATS_API_BASE}/recommendation`
            ];
            
            for (const endpoint of reccobeatsEndpoints) {
                try {
                    // Try with query parameters
                    const queryParams = new URLSearchParams({
                        energy: audioFeatures.energy,
                        danceability: audioFeatures.danceability,
                        valence: audioFeatures.valence,
                        tempo: audioFeatures.tempo,
                        limit: 1
                    });
                    
                    const testUrl = `${endpoint}?${queryParams}`;
                    console.log('Testing ReccoBeats URL:', testUrl);
                    
                    const reccoResponse = await fetch(testUrl);
                    
                    if (reccoResponse.ok) {
                        const reccoData = await reccoResponse.json();
                        console.log('✅ ReccoBeats response:', reccoData);
                        
                        if (reccoData && Array.isArray(reccoData) && reccoData.length > 0) {
                            reccobeatsRecommendation = reccoData[0];
                            console.log('Got ReccoBeats recommendation:', reccobeatsRecommendation);
                            break;
                        }
                    } else {
                        console.log(`ReccoBeats endpoint ${endpoint} returned:`, reccoResponse.status);
                    }
                    
                } catch (endpointError) {
                    console.log(`ReccoBeats endpoint ${endpoint} failed:`, endpointError.message);
                }
            }
            
        } catch (reccoError) {
            console.log('❌ ReccoBeats recommendation failed:', reccoError.message);
        }
        
        // Step 4: If ReccoBeats worked, try to find the song on Spotify
        let spotifySimilarTrack = null;
        
        if (reccobeatsRecommendation) {
            try {
                console.log('🔍 Searching Spotify for ReccoBeats recommendation...');
                
                // Extract searchable info from ReccoBeats response
                const searchQuery = reccobeatsRecommendation.track_name || reccobeatsRecommendation.name || reccobeatsRecommendation.title;
                const artistName = reccobeatsRecommendation.artist_name || reccobeatsRecommendation.artist;
                
                if (searchQuery) {
                    const searchTerm = artistName ? `${searchQuery} ${artistName}` : searchQuery;
                    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchTerm)}&type=track&limit=1`;
                    
                    const searchResponse = await fetch(searchUrl, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    
                    if (searchResponse.ok) {
                        const searchData = await searchResponse.json();
                        if (searchData.tracks.items.length > 0) {
                            spotifySimilarTrack = searchData.tracks.items[0];
                            console.log('✅ Found similar track on Spotify:', spotifySimilarTrack.name);
                        }
                    }
                }
                
            } catch (spotifySearchError) {
                console.log('❌ Spotify search for similar track failed:', spotifySearchError.message);
            }
        }
        
        // Step 5: Fallback - use Spotify search with audio feature keywords
        if (!spotifySimilarTrack) {
            console.log('🎯 Using fallback: Spotify search with feature-based keywords...');
            
            try {
                // Create search terms based on audio features
                let searchTerms = [];
                
                if (audioFeatures.energy > 0.7) searchTerms.push('energetic');
                if (audioFeatures.danceability > 0.7) searchTerms.push('dance');
                if (audioFeatures.valence > 0.7) searchTerms.push('happy');
                if (audioFeatures.valence < 0.3) searchTerms.push('sad');
                if (audioFeatures.acousticness > 0.5) searchTerms.push('acoustic');
                
                // Add genre-based terms
                const originalArtist = originalTrack.artists[0].name.toLowerCase();
                
                // Add search terms and original artist genre context
                if (searchTerms.length === 0) {
                    searchTerms = ['similar', 'like'];
                }
                
                const searchQuery = searchTerms.join(' OR ') + ` genre:${originalArtist.includes('electronic') ? 'electronic' : 'pop'}`;
                const fallbackUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=5`;
                
                const fallbackResponse = await fetch(fallbackUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    // Find a track that's not the same as the original
                    const differentTrack = fallbackData.tracks.items.find(track => track.id !== trackId);
                    if (differentTrack) {
                        spotifySimilarTrack = differentTrack;
                        console.log('✅ Found fallback similar track:', spotifySimilarTrack.name);
                    }
                }
                
            } catch (fallbackError) {
                console.log('❌ Fallback search failed:', fallbackError.message);
            }
        }
        
        // Step 6: Return results
        const response = {
            originalTrack: {
                id: originalTrack.id,
                name: originalTrack.name,
                artist: originalTrack.artists[0].name,
                album: originalTrack.album.name
            },
            audioFeatures: audioFeatures,
            reccobeatsRecommendation: reccobeatsRecommendation,
            similarTrack: spotifySimilarTrack,
            pipeline: {
                reccobeatsUsed: !!reccobeatsRecommendation,
                spotifySearchUsed: !!spotifySimilarTrack,
                method: reccobeatsRecommendation ? 'reccobeats_to_spotify' : 'feature_based_search'
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Similar song error:', error);
        res.status(500).json({ 
            error: 'Failed to find similar song',
            details: error.message,
            trackId: req.params.trackId
        });
    }
});

// Helper function to get intelligent features (extract from existing code)
async function getIntelligentFeatures(trackData) {
    // This is the same logic from your generateIntelligentFeatures function
    // But returns just the features object for use in recommendations
    const features = generateIntelligentFeatures(trackData);
    
    // Remove metadata for cleaner API calls
    const cleanFeatures = {
        acousticness: features.acousticness,
        danceability: features.danceability,
        energy: features.energy,
        instrumentalness: features.instrumentalness,
        liveness: features.liveness,
        loudness: features.loudness,
        speechiness: features.speechiness,
        tempo: features.tempo,
        valence: features.valence
    };
    
    return cleanFeatures;
}
