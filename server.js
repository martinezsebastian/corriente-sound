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

// ── Mood → search term mapping ────────────────────────────────
// Plain-text terms (no genre: field filter — that only works for type=artist, not type=track)

const MOOD_TERMS = {
    upbeat:   'dance electronic energetic upbeat',
    chill:    'acoustic chill ambient mellow',
    groovy:   'funk groove soul disco',
    romantic: 'soul love ballad romantic',
};

// ── Helpers ───────────────────────────────────────────────────

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
// NOTE: genre: field filter only works for type=artist searches, NOT type=track.
// We use plain-text genre terms and year: filters instead.

async function findSimilarTracks(originalTrack, token, moods = []) {
    const { artists, album } = originalTrack;
    const artistName  = artists[0].name;
    const artistId    = artists[0].id;
    const releaseYear = album.release_date ? album.release_date.split('-')[0] : null;
    const decade      = releaseYear ? Math.floor(Number(releaseYear) / 10) * 10 : null;

    // Fetch real artist genres (plain text, used as search terms)
    let genres = [];
    try {
        const r = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) genres = (await r.json()).genres || [];
    } catch (_) {}

    const genreText = genres.slice(0, 2).join(' ') || 'pop';
    const moodText  = moods.map(m => MOOD_TERMS[m] || '').filter(Boolean).join(' ');
    const combinedText = [genreText, moodText].filter(Boolean).join(' ');

    console.log(`🎸 ${originalTrack.name} — genres: [${genres.join(', ') || 'none'}] moods: [${moods.join(', ') || 'none'}]`);

    const strategies = [
        // Artist discography (most reliable — always returns results)
        { desc: 'same artist',  q: `artist:"${artistName}"` },
        // Genre + mood terms as plain text
        { desc: 'genre+mood',   q: combinedText },
        // Same decade + genre text (era match)
        decade ? { desc: 'era match', q: `year:${decade}-${decade + 9} ${genreText}` } : null,
        // Mood terms alone (broader net)
        moodText ? { desc: 'mood direct', q: moodText } : { desc: 'genre direct', q: genreText },
        // Same album (for album-mates)
        { desc: 'same album',   q: `album:"${album.name}"` },
    ].filter(Boolean);

    const results = await Promise.allSettled(
        strategies.map(({ desc, q }) =>
            fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=12`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.tracks?.items) return [];
                return data.tracks.items
                    .filter(t => t.id !== originalTrack.id)
                    .map(t => ({ ...t, _strategy: desc, _similarity: similarityScore(t, originalTrack) }));
            })
            .catch(() => [])
        )
    );

    const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const sorted = deduplicate(all).sort((a, b) => b._similarity - a._similarity);
    console.log(`🎯 Found ${sorted.length} candidates`);
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

app.get('/api/similar-song/:trackId', async (req, res) => {
    try {
        const token = await getSpotifyToken();
        const r = await fetch(`https://api.spotify.com/v1/tracks/${req.params.trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Track fetch failed: ${r.status}`);
        const originalTrack = await r.json();
        const similar       = await findSimilarTracks(originalTrack, token, []);
        const top5          = similar.slice(0, 5);

        res.json({
            originalTrack: { id: originalTrack.id, name: originalTrack.name, artist: originalTrack.artists[0].name },
            similarTracks: top5,
            pipeline: { method: 'smart_spotify_search', tracksFound: similar.length, topMatches: top5.length, success: top5.length > 0 },
        });
    } catch (err) {
        console.error('Similar song error:', err);
        res.status(500).json({ error: 'Failed to find similar song', details: err.message });
    }
});

app.get('/api/recommendations', async (req, res) => {
    const { seed_tracks, moods = '', limit = 9 } = req.query;
    if (!seed_tracks) return res.status(400).json({ error: 'seed_tracks parameter required' });
    try {
        const token    = await getSpotifyToken();
        const r        = await fetch(`https://api.spotify.com/v1/tracks/${seed_tracks}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return res.json([]);
        const trackData = await r.json();
        const moodList  = moods.split(',').filter(m => m && MOOD_TERMS[m]);
        const similar   = await findSimilarTracks(trackData, token, moodList);
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
