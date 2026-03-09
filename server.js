'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing Spotify credentials. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.');
}

// ── Token cache ───────────────────────────────────────────────

let spotifyAccessToken = '';
let tokenExpiryTime    = 0;

async function getSpotifyToken() {
    if (spotifyAccessToken && Date.now() < tokenExpiryTime - 300000) {
        return spotifyAccessToken;
    }
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        },
        body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`Token fetch failed: ${response.status}`);
    const data = await response.json();
    spotifyAccessToken = data.access_token;
    tokenExpiryTime    = Date.now() + data.expires_in * 1000;
    console.log('✅ Spotify token refreshed');
    return spotifyAccessToken;
}

// ── Genre → audio feature profiles ───────────────────────────
// Used to estimate features from the artist's genre tags (real Spotify data).
// Keys are substrings — a genre like "indie pop" matches both "indie" and "pop".

const GENRE_PROFILES = {
    'hip hop':     { energy: 0.70, danceability: 0.80, valence: 0.55, acousticness: 0.10, tempo:  92 },
    'rap':         { energy: 0.70, danceability: 0.78, valence: 0.50, acousticness: 0.10, tempo:  90 },
    'trap':        { energy: 0.65, danceability: 0.75, valence: 0.45, acousticness: 0.08, tempo:  72 },
    'pop':         { energy: 0.65, danceability: 0.70, valence: 0.65, acousticness: 0.15, tempo: 118 },
    'rock':        { energy: 0.80, danceability: 0.50, valence: 0.50, acousticness: 0.10, tempo: 128 },
    'metal':       { energy: 0.95, danceability: 0.40, valence: 0.30, acousticness: 0.04, tempo: 152 },
    'punk':        { energy: 0.90, danceability: 0.60, valence: 0.50, acousticness: 0.05, tempo: 160 },
    'electronic':  { energy: 0.80, danceability: 0.82, valence: 0.58, acousticness: 0.05, tempo: 126 },
    'house':       { energy: 0.80, danceability: 0.88, valence: 0.65, acousticness: 0.04, tempo: 125 },
    'techno':      { energy: 0.85, danceability: 0.85, valence: 0.40, acousticness: 0.03, tempo: 135 },
    'edm':         { energy: 0.82, danceability: 0.84, valence: 0.60, acousticness: 0.04, tempo: 128 },
    'dance':       { energy: 0.78, danceability: 0.85, valence: 0.65, acousticness: 0.05, tempo: 125 },
    'jazz':        { energy: 0.40, danceability: 0.55, valence: 0.60, acousticness: 0.70, tempo:  95 },
    'blues':       { energy: 0.45, danceability: 0.50, valence: 0.40, acousticness: 0.50, tempo:  88 },
    'soul':        { energy: 0.60, danceability: 0.65, valence: 0.65, acousticness: 0.30, tempo: 100 },
    'r&b':         { energy: 0.60, danceability: 0.75, valence: 0.60, acousticness: 0.20, tempo:  96 },
    'classical':   { energy: 0.25, danceability: 0.20, valence: 0.50, acousticness: 0.95, tempo: 100 },
    'folk':        { energy: 0.35, danceability: 0.40, valence: 0.55, acousticness: 0.85, tempo: 104 },
    'country':     { energy: 0.55, danceability: 0.60, valence: 0.65, acousticness: 0.50, tempo: 115 },
    'reggae':      { energy: 0.50, danceability: 0.75, valence: 0.75, acousticness: 0.30, tempo:  88 },
    'latin':       { energy: 0.65, danceability: 0.85, valence: 0.75, acousticness: 0.20, tempo: 110 },
    'reggaeton':   { energy: 0.75, danceability: 0.88, valence: 0.70, acousticness: 0.10, tempo:  96 },
    'indie':       { energy: 0.50, danceability: 0.50, valence: 0.45, acousticness: 0.40, tempo: 115 },
    'alternative': { energy: 0.60, danceability: 0.50, valence: 0.45, acousticness: 0.25, tempo: 122 },
    'ambient':     { energy: 0.15, danceability: 0.20, valence: 0.45, acousticness: 0.75, tempo:  85 },
    'acoustic':    { energy: 0.35, danceability: 0.45, valence: 0.55, acousticness: 0.90, tempo: 105 },
    'funk':        { energy: 0.70, danceability: 0.85, valence: 0.75, acousticness: 0.25, tempo: 108 },
    'gospel':      { energy: 0.65, danceability: 0.60, valence: 0.80, acousticness: 0.40, tempo: 108 },
    'k-pop':       { energy: 0.72, danceability: 0.78, valence: 0.68, acousticness: 0.12, tempo: 125 },
    'bossa':       { energy: 0.30, danceability: 0.60, valence: 0.65, acousticness: 0.80, tempo: 110 },
    'flamenco':    { energy: 0.65, danceability: 0.55, valence: 0.50, acousticness: 0.70, tempo: 120 },
};

// Secondary: track name keyword adjustments applied on top of genre base
const NAME_ADJUSTMENTS = [
    { words: ['dance','party','pump','fire','electric','power','energy'], delta: { energy: 0.15, danceability: 0.12, tempo: 15 } },
    { words: ['chill','relax','calm','slow','soft','gentle','peace','ambient'], delta: { energy: -0.20, acousticness: 0.20, tempo: -20 } },
    { words: ['sad','lonely','hurt','pain','tears','miss'],                delta: { valence: -0.25, energy: -0.10 } },
    { words: ['happy','joy','smile','sunshine','bright','celebration'],    delta: { valence:  0.20, energy:  0.10 } },
    { words: ['love','heart','romance','kiss','forever','beautiful'],      delta: { valence:  0.10, acousticness: 0.10 } },
];

async function getAudioFeatures(trackData, token) {
    // Step 1: fetch real artist genres from Spotify
    let genres = [];
    try {
        const artistId = trackData.artists[0].id;
        const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) genres = (await res.json()).genres || [];
    } catch (_) { /* fall through to defaults */ }

    console.log(`🎸 ${trackData.name} — genres: [${genres.join(', ') || 'none'}]`);

    // Step 2: blend matching genre profiles
    const FEATURE_KEYS = ['energy', 'danceability', 'valence', 'acousticness', 'tempo'];
    const base = {
        energy: 0.50, danceability: 0.50, valence: 0.50, acousticness: 0.30, tempo: 115,
        instrumentalness: 0.10, liveness: 0.12, loudness: -8.0, speechiness: 0.06,
    };

    const matches = [];
    for (const genre of genres) {
        const g = genre.toLowerCase();
        for (const [key, profile] of Object.entries(GENRE_PROFILES)) {
            if (g.includes(key)) { matches.push(profile); break; }
        }
    }
    if (matches.length > 0) {
        for (const key of FEATURE_KEYS) {
            base[key] = matches.reduce((s, m) => s + m[key], 0) / matches.length;
        }
    }

    // Step 3: track name keyword adjustments (secondary signal)
    const name = trackData.name.toLowerCase();
    for (const { words, delta } of NAME_ADJUSTMENTS) {
        if (words.some(w => name.includes(w))) {
            for (const [k, v] of Object.entries(delta)) {
                if (base[k] !== undefined) {
                    const min = k === 'tempo' ? 60 : 0;
                    const max = k === 'tempo' ? 200 : 1;
                    base[k] = Math.max(min, Math.min(max, base[k] + v));
                }
            }
        }
    }

    // Step 4: popularity / duration tweaks
    if (trackData.popularity > 70) {
        base.danceability = Math.min(0.85, base.danceability + 0.05);
        base.energy       = Math.min(0.85, base.energy + 0.05);
    }
    if (trackData.duration_ms > 300000) {
        base.instrumentalness = Math.min(0.50, base.instrumentalness + 0.10);
    }

    // Round to 3 decimal places
    for (const k of Object.keys(base)) {
        base[k] = Math.round(base[k] * 1000) / 1000;
    }

    return base;
}

// ── Search strategy helpers ───────────────────────────────────

function getGenreFromFeatures(f) {
    if (f.energy > 0.8 && f.danceability > 0.7) return 'electronic dance';
    if (f.energy > 0.7 && f.tempo > 140)         return 'rock';
    if (f.acousticness > 0.6)                     return 'folk';
    if (f.danceability > 0.7)                     return 'pop';
    if (f.valence < 0.3)                          return 'indie';
    if (f.energy < 0.4)                           return 'ambient';
    return 'pop';
}

function getFeatureKeywords(f) {
    const kw = [];
    if (f.energy > 0.7)       kw.push('energetic', 'upbeat');
    if (f.energy < 0.3)       kw.push('calm', 'mellow');
    if (f.danceability > 0.7) kw.push('danceable', 'groovy');
    if (f.valence > 0.7)      kw.push('happy', 'joyful');
    if (f.valence < 0.3)      kw.push('melancholy', 'emotional');
    if (f.acousticness > 0.6) kw.push('acoustic', 'intimate');
    if (f.tempo > 140)        kw.push('fast', 'driving');
    if (f.tempo < 80)         kw.push('slow', 'ballad');
    return kw.length ? kw : ['similar'];
}

function similarityScore(candidate, original) {
    let score = 1.0;
    if (candidate.artists[0].name.toLowerCase() === original.artists[0].name.toLowerCase()) score -= 0.30;
    score -= Math.abs(candidate.popularity - original.popularity) / 100 * 0.10;
    score -= Math.min(Math.abs(candidate.duration_ms - original.duration_ms) / original.duration_ms, 0.5) * 0.10;
    if (candidate.preview_url)                    score += 0.10;
    if (candidate.explicit === original.explicit) score += 0.05;
    return Math.max(0, score);
}

function deduplicate(tracks) {
    const seen = new Set();
    return tracks.filter(t => {
        const key = `${t.name.toLowerCase()}-${t.artists[0].name.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ── Parallel similarity search ────────────────────────────────

async function findSimilarTracks(originalTrack, features, token) {
    const { name: trackName, artists, album } = originalTrack;
    const artistName  = artists[0].name;
    const releaseYear = album.release_date ? album.release_date.split('-')[0] : null;
    const decade      = releaseYear ? Math.floor(releaseYear / 10) * 10 : null;

    const strategies = [
        { desc: 'similar genre', q: `genre:"${getGenreFromFeatures(features)}" NOT artist:"${artistName}"` },
        { desc: 'same artist',   q: `artist:"${artistName}" NOT track:"${trackName}"` },
        { desc: 'mood keywords', q: `${getFeatureKeywords(features).join(' OR ')} NOT artist:"${artistName}"` },
        decade ? { desc: 'same decade', q: `year:${decade}-${decade + 9} NOT artist:"${artistName}"` } : null,
        { desc: 'same album',    q: `album:"${album.name}" NOT track:"${trackName}"` },
    ].filter(Boolean);

    const results = await Promise.allSettled(
        strategies.map(({ desc, q }) =>
            fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return [];
                return data.tracks.items
                    .filter(t => t.id !== originalTrack.id)
                    .map(t => ({ ...t, _strategy: desc, _similarity: similarityScore(t, originalTrack) }));
            })
            .catch(() => [])
        )
    );

    const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const sorted = deduplicate(all).sort((a, b) => b._similarity - a._similarity);
    console.log(`🎯 Found ${sorted.length} similar tracks`);
    return sorted;
}

// ── API routes ────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Corriente Sound API is running' });
});

app.post('/api/auth', async (req, res) => {
    try {
        await getSpotifyToken();
        res.json({ success: true });
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ success: false, error: 'Failed to authenticate with Spotify' });
    }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter required' });
    try {
        const token = await getSpotifyToken();
        const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=5`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Spotify search error: ${r.status}`);
        const data = await r.json();
        res.json(data.tracks.items);
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/audio-features/:trackId', async (req, res) => {
    try {
        const token = await getSpotifyToken();
        const r = await fetch(`https://api.spotify.com/v1/tracks/${req.params.trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Track fetch failed: ${r.status}`);
        const features = await getAudioFeatures(await r.json(), token);
        res.json(features);
    } catch (err) {
        console.error('Audio features error:', err);
        res.status(500).json({ error: 'Failed to get audio features', details: err.message });
    }
});

app.get('/api/similar-song/:trackId', async (req, res) => {
    try {
        const token = await getSpotifyToken();
        const r = await fetch(`https://api.spotify.com/v1/tracks/${req.params.trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Track fetch failed: ${r.status}`);
        const originalTrack = await r.json();
        const features      = await getAudioFeatures(originalTrack, token);
        const similar       = await findSimilarTracks(originalTrack, features, token);
        const top5          = similar.slice(0, 5);

        res.json({
            originalTrack: { id: originalTrack.id, name: originalTrack.name, artist: originalTrack.artists[0].name },
            audioFeatures: features,
            similarTracks: top5,
            pipeline: { method: 'smart_spotify_search', tracksFound: similar.length, topMatches: top5.length, success: top5.length > 0 },
        });
    } catch (err) {
        console.error('Similar song error:', err);
        res.status(500).json({ error: 'Failed to find similar song', details: err.message });
    }
});

app.get('/api/recommendations', async (req, res) => {
    const { seed_tracks, limit = 9 } = req.query;
    if (!seed_tracks) return res.status(400).json({ error: 'seed_tracks parameter required' });
    try {
        const token = await getSpotifyToken();
        const r = await fetch(`https://api.spotify.com/v1/tracks/${seed_tracks}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return res.json([]);
        const trackData = await r.json();
        const features  = await getAudioFeatures(trackData, token);
        const similar   = await findSimilarTracks(trackData, features, token);
        res.json(similar.slice(0, Number(limit)));
    } catch (err) {
        console.error('Recommendations error:', err);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

app.get('/', (req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.send('<h1>Corriente Sound</h1><p>Place index.html in the public/ folder.</p>');
    }
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`🎵 Corriente Sound running on http://localhost:${PORT}`);
    getSpotifyToken()
        .then(() => console.log('✅ Spotify connected'))
        .catch(err => console.error('❌ Spotify connection failed:', err.message));
});
