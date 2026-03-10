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
const LASTFM_API_KEY        = process.env.LASTFM_API_KEY || '7243445ee40326b73890c4bac762138d';

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

// ── Mood → Last.fm tags ────────────────────────────────────────
// Used to filter co-listened tracks by mood via Last.fm track.getTopTags.

const MOOD_LASTFM_TAGS = {
    upbeat: [
        'dance', 'electronic', 'electronica', 'house', 'techno', 'pop', 'energetic', 'upbeat',
        'edm', 'dubstep', 'rave', 'party', 'happy', 'indie pop', 'dance pop', 'electropop',
        'synthpop', 'eurodance', 'trance', 'hip hop', 'hip-hop', 'rap', 'trap', 'reggaeton',
        'dancehall', 'k-pop', 'j-pop', 'new rave', 'electro', 'disco',
    ],
    chill: [
        'chill', 'chillout', 'downtempo', 'trip-hop', 'trip hop', 'ambient', 'lo-fi', 'acoustic',
        'indie', 'lush', 'folk', 'folk rock', 'singer-songwriter', 'mellow', 'soft rock', 'lounge',
        'new age', 'meditation', 'relaxing', 'calm', 'quiet', 'soft', 'dream pop', 'shoegaze',
        'indie folk', 'post-rock', 'slowcore', 'chillwave', 'atmospheric', 'dreamy', 'sleep',
        'romantic', 'romantica', 'baladas', 'love', 'ballad', 'love songs', 'melancholic',
        'melancholy', 'nostalgic', 'bittersweet', 'ethereal', 'sweet', 'sad',
    ],
    smooth: [
        'soul', 'funk', 'jazz', 'r&b', 'rnb', 'rhythm and blues', 'motown', 'groove', 'funky',
        'smooth jazz', 'neo soul', 'acid jazz', 'vocal jazz', 'jazz fusion', 'blues', 'bossa nova',
        'latin jazz', 'swing', 'big band', 'bebop', 'nu jazz', 'jazzy', 'soulful', 'afrobeat',
        'dub', 'reggae', 'slow jams', 'sensual', 'latin',
    ],
};

// ── Helpers ───────────────────────────────────────────────────

async function batchedPromiseAll(items, fn, batchSize = 10) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = await Promise.allSettled(items.slice(i, i + batchSize).map(fn));
        results.push(...batch);
    }
    return results;
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

// ── Recommendation engine ─────────────────────────────────────
//
// 1. Last.fm artist.getSimilar  — find artists in the same space
// 2. Last.fm artist.getTopTracks — top tracks per similar artist
// 3. Spotify hydration          — full track objects (artwork, URI)
// 4. Last.fm tag filter         — keep only tracks matching selected mood
// 5. Seed artist top tracks     — 2 tracks from the same artist
// 6. Fallback                   — genre search if Last.fm returns nothing

async function findSimilarTracks(originalTrack, token, moods = [], excludeIds = new Set()) {
    const artistId   = originalTrack.artists[0].id;
    const artistName = originalTrack.artists[0].name;
    const headers    = { Authorization: `Bearer ${token}` };

    // 1. Last.fm similar artists
    let similarArtists = [];
    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar` +
            `&artist=${encodeURIComponent(artistName)}` +
            `&api_key=${LASTFM_API_KEY}&format=json&limit=20&autocorrect=1`;
        const r = await fetch(url);
        if (r.ok) {
            const data = await r.json();
            similarArtists = data.similarartists?.artist || [];
        }
    } catch (_) {}

    console.log(`🎸 Last.fm: ${similarArtists.length} similar artists for "${artistName}", moods: [${moods.join(', ') || 'none'}]`);

    // 2. Top tracks for each similar artist
    const artistTrackFetches = await batchedPromiseAll(similarArtists.slice(0, 15), artist => {
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks` +
            `&artist=${encodeURIComponent(artist.name)}` +
            `&api_key=${LASTFM_API_KEY}&format=json&limit=5&autocorrect=1`;
        return fetch(url)
            .then(r => r.ok ? r.json() : null)
            .then(data => (data?.toptracks?.track || []).map(t => ({
                name: t.name,
                artist: artist.name,
                _artistMatch: Number(artist.match),
            })))
            .catch(() => []);
    }, 8);

    const trackCandidates = artistTrackFetches.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    console.log(`📋 ${trackCandidates.length} track candidates from similar artists`);

    // 3. Hydrate with Spotify
    const hydrated = await batchedPromiseAll(trackCandidates, lfm => {
        const q = encodeURIComponent(`track:"${lfm.name}" artist:"${lfm.artist}"`);
        return fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                const t = data?.tracks?.items?.[0];
                if (!t) return null;
                return { ...t, _lfmMatch: lfm._artistMatch, _strategy: 'lastfm' };
            })
            .catch(() => null);
    }, 10);

    let tracks = hydrated
        .flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
        .filter(t => t.id !== originalTrack.id && !excludeIds.has(t.id));

    const lfmHydratedCount = tracks.length;

    // 4. Tag filter by mood
    if (moods.length > 0 && tracks.length > 0) {
        const moodTagSet = new Set(moods.flatMap(m => MOOD_LASTFM_TAGS[m] || []));

        const tagResults = await batchedPromiseAll(tracks, t => {
            const url = `https://ws.audioscrobbler.com/2.0/?method=track.getTopTags` +
                `&artist=${encodeURIComponent(t.artists[0].name)}&track=${encodeURIComponent(t.name)}` +
                `&api_key=${LASTFM_API_KEY}&format=json&autocorrect=1`;
            return fetch(url)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    const tags = (data?.toptags?.tag || []).map(tag => tag.name.toLowerCase());
                    const matches = tags.some(tag =>
                        [...moodTagSet].some(mt => tag.includes(mt) || mt.includes(tag))
                    );
                    return { id: t.id, matches };
                })
                .catch(() => ({ id: t.id, matches: false }));
        }, 8);

        const matchSet = new Set(
            tagResults
                .flatMap(r => r.status === 'fulfilled' ? [r.value] : [])
                .filter(r => r.matches)
                .map(r => r.id)
        );

        console.log(`🏷️  Mood tag matches: ${matchSet.size} / ${tracks.length}`);

        tracks = tracks
            .filter(t => matchSet.has(t.id))
            .map(t => ({ ...t, _similarity: t._lfmMatch }));
    } else {
        tracks = tracks.map(t => ({ ...t, _similarity: t._lfmMatch }));
    }

    // 5. Seed artist's own top tracks (2)
    try {
        const r = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, { headers });
        if (r.ok) {
            ((await r.json()).tracks || [])
                .filter(t => t.id !== originalTrack.id && !excludeIds.has(t.id))
                .slice(0, 2)
                .forEach(t => tracks.push({ ...t, _strategy: 'seed artist', _similarity: 0.9 }));
        }
    } catch (_) {}

    // 6. Fallback: only if Last.fm genuinely didn't know the artist
    if (lfmHydratedCount < 3) {
        console.log('⚠️  Last.fm sparse — falling back to genre-artist search');
        let seedGenres = [];
        try {
            const r = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers });
            if (r.ok) seedGenres = (await r.json()).genres || [];
        } catch (_) {}

        const primaryGenre = seedGenres[0] || 'pop';
        const q = encodeURIComponent(`genre:"${primaryGenre}"`);
        const fallbackArtists = await fetch(
            `https://api.spotify.com/v1/search?q=${q}&type=artist&limit=20`, { headers }
        ).then(r => r.ok ? r.json() : null).then(d => d?.artists?.items || []).catch(() => []);

        const seen = new Set([artistId]);
        const picked = fallbackArtists
            .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
            .slice(0, 7);

        const fallbackResults = await Promise.allSettled(
            picked.map(artist =>
                fetch(`https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`, { headers })
                .then(r => r.ok ? r.json() : null)
                .then(data => (data?.tracks || [])
                    .filter(t => t.id !== originalTrack.id).slice(0, 3)
                    .map(t => ({ ...t, _strategy: 'genre fallback', _similarity: 0.5 }))
                ).catch(() => [])
            )
        );
        fallbackResults.flatMap(r => r.status === 'fulfilled' ? r.value : []).forEach(t => tracks.push(t));
    }

    const sorted = deduplicate(tracks)
        .filter(t => t.id !== originalTrack.id)
        .sort((a, b) => (b._similarity || 0) - (a._similarity || 0));

    console.log(`🎯 ${sorted.length} final tracks`);
    return sorted;
}

// ── API routes ────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Corriente Sound API is running' });
});

// Expose public client ID so the frontend can run PKCE OAuth without embedding secrets
app.get('/api/config', (req, res) => {
    res.json({ clientId: SPOTIFY_CLIENT_ID });
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
    const { seed_tracks, moods = '', limit = 5, exclude_ids = '' } = req.query;
    if (!seed_tracks) return res.status(400).json({ error: 'seed_tracks parameter required' });
    try {
        const token      = await getSpotifyToken();
        const r          = await fetch(`https://api.spotify.com/v1/tracks/${seed_tracks}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return res.json([]);
        const trackData  = await r.json();
        const moodList   = moods.split(',').filter(m => m && MOOD_LASTFM_TAGS[m] !== undefined);
        const excludeIds = new Set(exclude_ids.split(',').filter(Boolean));
        const similar    = await findSimilarTracks(trackData, token, moodList, excludeIds);
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
