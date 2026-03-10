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
    upbeat:   ['dance', 'electronic', 'electronica', 'house', 'techno', 'pop', 'energetic', 'upbeat'],
    chill:    ['chill', 'chillout', 'downtempo', 'trip-hop', 'ambient', 'lo-fi', 'acoustic', 'indie', 'lush'],
    smooth:   ['funk', 'disco', 'soul', 'groove', 'r&b', 'rnb', 'rhythm and blues', 'motown'],
    romantic: ['romantic', 'romantica', 'baladas', 'love', 'soul', 'ballad', 'slowcore'],
};

// ── Helpers ───────────────────────────────────────────────────

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
// 1. Last.fm track.getSimilar  — co-listened track candidates
// 2. Spotify hydration         — full track objects (artwork, URI)
// 3. Last.fm tag filter        — keep full score if track tags match mood,
//                                deprioritize those that don't
// 4. Seed artist top tracks    — 2 tracks from the same artist
// 5. Fallback                  — genre search if Last.fm returns nothing

async function findSimilarTracks(originalTrack, token, moods = []) {
    const artistId   = originalTrack.artists[0].id;
    const artistName = originalTrack.artists[0].name;
    const trackName  = originalTrack.name;
    const headers    = { Authorization: `Bearer ${token}` };

    // 1. Last.fm similar tracks (listening-pattern based)
    let lfmTracks = [];
    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar` +
            `&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}` +
            `&api_key=${LASTFM_API_KEY}&format=json&limit=50&autocorrect=1`;
        const r = await fetch(url);
        if (r.ok) {
            const data = await r.json();
            lfmTracks = data.similartracks?.track || [];
        }
    } catch (_) {}

    console.log(`🎸 Last.fm: ${lfmTracks.length} similar tracks for "${trackName}" by ${artistName}, moods: [${moods.join(', ') || 'none'}]`);

    // 2. Hydrate with Spotify
    const hydrated = await Promise.allSettled(
        lfmTracks.slice(0, 40).map(lfm => {
            const q = encodeURIComponent(`track:"${lfm.name}" artist:"${lfm.artist.name}"`);
            return fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, { headers })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    const t = data?.tracks?.items?.[0];
                    if (!t) return null;
                    return { ...t, _lfmMatch: Number(lfm.match), _strategy: 'lastfm' };
                })
                .catch(() => null);
        })
    );

    let tracks = hydrated
        .flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
        .filter(t => t.id !== originalTrack.id);

    const lfmHydratedCount = tracks.length; // snapshot before mood filter, for fallback check

    // 3. Tag filter: fetch Last.fm tags for each hydrated track.
    //    Tracks whose tags match the selected mood keep their full _lfmMatch score.
    //    Tracks that don't match are heavily deprioritized (not discarded, as a safety net).
    if (moods.length > 0 && tracks.length > 0) {
        const moodTagSet = new Set(moods.flatMap(m => MOOD_LASTFM_TAGS[m] || []));

        const tagResults = await Promise.allSettled(
            tracks.map(t => {
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
            })
        );

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

    // 4. Seed artist's own top tracks (2)
    try {
        const r = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, { headers });
        if (r.ok) {
            ((await r.json()).tracks || [])
                .filter(t => t.id !== originalTrack.id)
                .slice(0, 2)
                .forEach(t => tracks.push({ ...t, _strategy: 'seed artist', _similarity: 0.9 }));
        }
    } catch (_) {}

    // 5. Fallback: only if Last.fm genuinely didn't know the song (before mood filtering)
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

    console.log(`🎯 ${sorted.length} candidates (${tracks.filter(t=>t._strategy==='lastfm').length} from Last.fm)`);
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
    const { seed_tracks, moods = '', limit = 9 } = req.query;
    if (!seed_tracks) return res.status(400).json({ error: 'seed_tracks parameter required' });
    try {
        const token    = await getSpotifyToken();
        const r        = await fetch(`https://api.spotify.com/v1/tracks/${seed_tracks}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return res.json([]);
        const trackData = await r.json();
        const moodList  = moods.split(',').filter(m => m && MOOD_LASTFM_TAGS[m] !== undefined);
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
