// Complete updated server.js with smart similar song system

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
        
        console.log('✅ New Spotify token obtained, expires in:', data.expires_in, 'seconds');
        return spotifyAccessToken;
    } catch (error) {
        console.error('Error getting Spotify token:', error);
        throw error;
    }
}

// Generate intelligent features based on track metadata and genre
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
    const energeticWords = ['dance', 'party', 'pump', 'wild', 'fire', 'electric', 'power', 'energy', 'rock', 'metal'];
    const chillWords = ['chill', 'relax', 'calm', 'slow', 'soft', 'gentle', 'peace', 'quiet', 'ambient'];
    const sadWords = ['sad', 'cry', 'tears', 'lonely', 'hurt', 'pain', 'goodbye', 'miss', 'sorry'];
    const happyWords = ['happy', 'joy', 'love', 'smile', 'sunshine', 'bright', 'celebration', 'party'];
    const romanticWords = ['love', 'heart', 'romance', 'kiss', 'together', 'forever', 'beautiful', 'baby'];
    
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

// Helper function to get intelligent features (clean version for API calls)
async function getIntelligentFeatures(trackData) {
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

// Generate genre from audio features
function getGenreFromFeatures(features) {
    if (features.energy > 0.8 && features.danceability > 0.7) return 'electronic dance';
    if (features.energy > 0.7 && features.tempo > 140) return 'rock';
    if (features.acousticness > 0.6) return 'folk';
    if (features.danceability > 0.7) return 'pop';
    if (features.valence < 0.3) return 'indie';
    if (features.energy < 0.4) return 'ambient';
    return 'pop'; // default
}

// Generate keywords from audio features
function getFeatureKeywords(features) {
    const keywords = [];
    
    if (features.energy > 0.7) keywords.push('energetic', 'upbeat', 'powerful');
    if (features.energy < 0.3) keywords.push('calm', 'mellow', 'peaceful');
    
    if (features.danceability > 0.7) keywords.push('danceable', 'groovy', 'rhythm');
    if (features.danceability < 0.3) keywords.push('contemplative', 'thoughtful');
    
    if (features.valence > 0.7) keywords.push('happy', 'joyful', 'cheerful');
    if (features.valence < 0.3) keywords.push('melancholy', 'emotional', 'introspective');
    
    if (features.acousticness > 0.6) keywords.push('acoustic', 'unplugged', 'intimate');
    if (features.acousticness < 0.2) keywords.push('electric', 'produced', 'synthetic');
    
    if (features.tempo > 140) keywords.push('fast', 'driving');
    if (features.tempo < 80) keywords.push('slow', 'ballad');
    
    return keywords.length > 0 ? keywords : ['similar', 'like'];
}

// Calculate similarity score between tracks
function calculateSimilarityScore(targetFeatures, candidateTrack, originalTrack) {
    let score = 1.0; // Start with perfect score
    
    // Penalty for same artist (we want different artists)
    if (candidateTrack.artists[0].name.toLowerCase() === originalTrack.artists[0].name.toLowerCase()) {
        score -= 0.3;
    }
    
    // Bonus for similar popularity
    const popularityDiff = Math.abs(candidateTrack.popularity - originalTrack.popularity) / 100;
    score -= popularityDiff * 0.1;
    
    // Bonus for similar duration
    const durationDiff = Math.abs(candidateTrack.duration_ms - originalTrack.duration_ms) / originalTrack.duration_ms;
    score -= Math.min(durationDiff, 0.5) * 0.1;
    
    // Bonus for having preview (better user experience)
    if (candidateTrack.preview_url) score += 0.1;
    
    // Bonus for being explicit if original was explicit
    if (originalTrack.explicit === candidateTrack.explicit) score += 0.05;
    
    return Math.max(0, score);
}

// Remove duplicate tracks
function removeDuplicateTracks(tracks) {
    const seen = new Set();
    return tracks.filter(track => {
        const key = `${track.name.toLowerCase()}-${track.artists[0].name.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Smart Spotify similarity search
async function findSimilarTracksViaSpotify(originalTrack, audioFeatures, token) {
    console.log('🎯 Using smart Spotify similarity search...');
    
    const artistName = originalTrack.artists[0].name;
    const trackName = originalTrack.name;
    const albumName = originalTrack.album.name;
    const releaseYear = originalTrack.album.release_date ? originalTrack.album.release_date.split('-')[0] : null;
    
    // Create multiple search strategies
    const searchStrategies = [
        // Strategy 1: Similar artists in the same genre
        {
            query: `genre:"${getGenreFromFeatures(audioFeatures)}" NOT artist:"${artistName}"`,
            description: 'Similar genre, different artist'
        },
        
        // Strategy 2: Same artist, different songs
        {
            query: `artist:"${artistName}" NOT track:"${trackName}"`,
            description: 'Same artist, different song'
        },
        
        // Strategy 3: Feature-based descriptive search
        {
            query: `${getFeatureKeywords(audioFeatures).join(' OR ')} NOT artist:"${artistName}"`,
            description: 'Feature-based keywords'
        },
        
        // Strategy 4: Era-based search (same decade)
        {
            query: releaseYear ? `year:${Math.floor(releaseYear / 10) * 10}-${Math.floor(releaseYear / 10) * 10 + 9} NOT artist:"${artistName}"` : null,
            description: 'Same decade'
        },
        
        // Strategy 5: Album tracks (if it's a compilation/multi-artist album)
        {
            query: `album:"${albumName}" NOT track:"${trackName}"`,
            description: 'Same album'
        }
    ].filter(strategy => strategy.query); // Remove null queries
    
    const allCandidates = [];
    
    // Execute each search strategy
    for (const strategy of searchStrategies) {
        try {
            console.log(`Trying strategy: ${strategy.description}`);
            console.log(`Query: ${strategy.query}`);
            
            const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(strategy.query)}&type=track&limit=10`;
            
            const searchResponse = await fetch(searchUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                const tracks = searchData.tracks.items.filter(track => track.id !== originalTrack.id);
                
                console.log(`Strategy "${strategy.description}" found ${tracks.length} tracks`);
                
                // Add strategy info to tracks
                tracks.forEach(track => {
                    track._strategy = strategy.description;
                    track._similarity = calculateSimilarityScore(audioFeatures, track, originalTrack);
                });
                
                allCandidates.push(...tracks);
            }
            
        } catch (strategyError) {
            console.log(`Strategy "${strategy.description}" failed:`, strategyError.message);
        }
    }
    
    // Remove duplicates and sort by similarity
    const uniqueCandidates = removeDuplicateTracks(allCandidates);
    const sortedCandidates = uniqueCandidates.sort((a, b) => b._similarity - a._similarity);
    
    console.log(`Found ${sortedCandidates.length} unique similar tracks`);
    
    // Return top 3 matches
    return sortedCandidates.slice(0, 10);
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Corriente Sound API is running',
        integrations: {
            spotify: 'Search functionality',
            intelligent_analysis: 'Audio feature estimation',
            smart_similarity: 'Multi-strategy track matching'
        }
    });
});

// Test endpoint for debugging
app.get('/api/test-reccobeats/:trackId', async (req, res) => {
    const { trackId } = req.params;
    
    try {
        console.log('🧪 Testing systems with track ID:', trackId);
        
        // Test 1: Get track from Spotify
        const token = await getSpotifyToken();
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const trackData = await trackResponse.json();
        
        // Test 2: Generate features
        const features = generateIntelligentFeatures(trackData);
        
        // Test 3: Test search strategies
        const similarTracks = await findSimilarTracksViaSpotify(trackData, features, token);
        
        res.json({
            test: 'System functionality test',
            trackData: {
                name: trackData.name,
                artist: trackData.artists[0].name
            },
            features: features,
            similarTracksFound: similarTracks.length,
            similarTracks: similarTracks.map(t => ({
                name: t.name,
                artist: t.artists[0].name,
                strategy: t._strategy,
                similarity: t._similarity
            }))
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

// Get audio features - intelligent estimation
app.get('/api/audio-features/:trackId', async (req, res) => {
    try {
        const { trackId } = req.params;
        console.log(`🎯 Getting audio features for track: ${trackId}`);
        
        // Get track info from Spotify
        const token = await getSpotifyToken();
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!trackResponse.ok) {
            throw new Error(`Failed to get track info: ${trackResponse.status}`);
        }
        
        const trackData = await trackResponse.json();
        console.log('Track info:', trackData.name, 'by', trackData.artists[0].name);
        
        // Generate intelligent features
        const features = generateIntelligentFeatures(trackData);
        
        res.json(features);
        
    } catch (error) {
        console.error('Audio features error:', error);
        res.status(500).json({ 
            error: 'Failed to get audio features',
            details: error.message,
            trackId: req.params.trackId
        });
    }
});

// Get similar song - smart Spotify search
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
        
        // Step 3: Find similar tracks using smart search
        const similarTracks = await findSimilarTracksViaSpotify(originalTrack, audioFeatures, token);
        
        // Step 4: Return top 5 matches instead of just 1
        const topMatches = similarTracks.length > 0 ? similarTracks.slice(0, 5) : [];
        
        const response = {
            originalTrack: {
                id: originalTrack.id,
                name: originalTrack.name,
                artist: originalTrack.artists[0].name,
                album: originalTrack.album.name
            },
            audioFeatures: audioFeatures,
            similarTracks: topMatches,  // Changed from 'similarTrack' to 'similarTracks' (plural)
            allSimilarTracks: similarTracks, // Keep all for debugging
            pipeline: {
                method: 'smart_spotify_search',
                tracksFound: similarTracks.length,
                topMatches: topMatches.length,
                success: topMatches.length > 0
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

// Simple recommendation system (placeholder for mood-based recommendations)
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

        // For now, return similar tracks as recommendations
        // This will be enhanced with mood-steering logic later
        const token = await getSpotifyToken();
        const trackResponse = await fetch(`https://api.spotify.com/v1/tracks/${seed_tracks}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (trackResponse.ok) {
            const trackData = await trackResponse.json();
            const audioFeatures = await getIntelligentFeatures(trackData);
            const similarTracks = await findSimilarTracksViaSpotify(trackData, audioFeatures, token);
            
            // Return up to the requested limit
            const recommendations = similarTracks.slice(0, Math.min(limit, similarTracks.length));
            res.json(recommendations);
        } else {
            res.json([]);
        }
        
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
            <p>Backend API is working with smart similarity search!</p>
            <p>API endpoints:</p>
            <ul>
                <li><a href="/api/health">/api/health</a> - Service status</li>
                <li><a href="/api/test-reccobeats/2IK9ckKC3t566rQcW1A6aE">/api/test-reccobeats/trackId</a> - Test systems</li>
                <li>POST /api/auth - Authenticate with Spotify</li>
                <li>GET /api/search?q=query - Search for songs</li>
                <li>GET /api/audio-features/:trackId - Get audio features</li>
                <li>GET /api/similar-song/:trackId - Find similar song</li>
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
    console.log('🎯 Features:');
    console.log('   - Spotify API: Search functionality');
    console.log('   - Intelligent Analysis: Audio feature estimation');
    console.log('   - Smart Similarity: Multi-strategy track matching');
    
    // Test connections on startup
    getSpotifyToken()
        .then(() => console.log('✅ Spotify API connection successful'))
        .catch(err => console.error('❌ Spotify API connection failed:', err.message));
});
