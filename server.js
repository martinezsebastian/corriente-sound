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

// ── Mood → genre affinity ─────────────────────────────────────
// Used to rank related artists by how well their genres match the selected mood.

const MOOD_GENRE_AFFINITY = {
    upbeat:   ['dance', 'pop', 'electronic', 'edm', 'house', 'disco', 'club', 'funk', 'energetic'],
    chill:    ['acoustic', 'ambient', 'folk', 'indie', 'chill', 'soft', 'lo-fi', 'singer-songwriter', 'dream'],
    groovy:   ['funk', 'soul', 'disco', 'r&b', 'groove', 'motown', 'jazz', 'afrobeat'],
    romantic: ['soul', 'r&b', 'ballad', 'jazz', 'bossa', 'classical', 'soft rock', 'neo soul'],
};

// ── Helpers ───────────────────────────────────────────────────

function moodGenreScore(artistGenres, moods) {
    if (!moods.length) return 0.5;
    const genreStr = artistGenres.join(' ').toLowerCase();
    let hits = 0;
    for (const mood of moods) {
        for (const term of (MOOD_GENRE_AFFINITY[mood] || [])) {
            if (genreStr.includes(term)) hits++;
        }
    }
    // Normalize: each mood can contribute up to ~3 hits realistically
    return Math.min(1, hits / (moods.length * 3));
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
// /v1/artists/{id}/related-artists was deprecated Nov 2024.
// /v1/recommendations was also deprecated for third-party apps.
//
// Working approach:
//   1. Get seed artist's genres via /v1/artists/{id}
//   2. Search for OTHER artists sharing those genres (genre: filter works for type=artist)
//   3. Rank those artists by mood-genre affinity
//   4. Pull top tracks from the best-matched artists in parallel
//   5. Mix in 2 of the seed artist's own tracks

async function findSimilarTracks(originalTrack, token, moods = []) {
    const artistId   = originalTrack.artists[0].id;
    const artistName = originalTrack.artists[0].name;
    const headers    = { Authorization: `Bearer ${token}` };

    // 1. Get seed artist's genres
    let seedGenres = [];
    try {
        const r = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers });
        if (r.ok) seedGenres = (await r.json()).genres || [];
    } catch (_) {}

    console.log(`🎸 ${originalTrack.name} — genres: [${seedGenres.slice(0,3).join(', ') || 'none'}] moods: [${moods.join(', ') || 'none'}]`);

    // 2. Search for artists sharing the seed's genres.
    //    genre: field filter DOES work for type=artist searches.
    //    Run 2 queries in parallel: primary (specific genres) + mood-adjusted.
    const primaryGenre = seedGenres[0] || 'pop';
    const secondGenre  = seedGenres[1] || seedGenres[0] || 'indie';

    const moodAffinityTerms = moods.flatMap(m => (MOOD_GENRE_AFFINITY[m] || []).slice(0, 2));
    const moodGenre = moodAffinityTerms[0] || primaryGenre;

    const searchArtistsByGenre = (genre, limit = 20) => {
        const q = encodeURIComponent(`genre:"${genre}"`);
        return fetch(`https://api.spotify.com/v1/search?q=${q}&type=artist&limit=${limit}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(d => d?.artists?.items || [])
            .catch(() => []);
    };

    const artistSearches = await Promise.allSettled([
        searchArtistsByGenre(primaryGenre, 20),
        searchArtistsByGenre(secondGenre, 20),
        moodGenre !== primaryGenre ? searchArtistsByGenre(moodGenre, 15) : Promise.resolve([]),
    ]);

    // Merge, deduplicate by artist id, exclude the seed artist
    const allArtists = artistSearches
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(a => a.id !== artistId);

    const seenArtists = new Set();
    const uniqueArtists = allArtists.filter(a => {
        if (seenArtists.has(a.id)) return false;
        seenArtists.add(a.id);
        return true;
    });

    // 3. Score by mood-genre fit, take top 7
    const picked = uniqueArtists
        .map(a => ({ ...a, _moodScore: moodGenreScore(a.genres, moods) }))
        .sort((a, b) => b._moodScore - a._moodScore)
        .slice(0, 7);

    console.log(`👥 ${uniqueArtists.length} candidate artists → picked top ${picked.length}`);

    // 4. Top tracks from each picked artist (3 tracks each) + 2 seed-artist tracks
    const artistsToFetch = [
        ...picked.map(a => ({ ...a, _isSeedArtist: false })),
        { id: artistId, name: artistName, _moodScore: 1.0, _isSeedArtist: true },
    ];

    const trackResults = await Promise.allSettled(
        artistsToFetch.map(artist =>
            fetch(`https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.tracks) return [];
                const limit = artist._isSeedArtist ? 2 : 3;
                return data.tracks
                    .filter(t => t.id !== originalTrack.id)
                    .slice(0, limit)
                    .map(t => ({
                        ...t,
                        _strategy: artist._isSeedArtist ? 'seed artist' : 'genre match',
                        _similarity: artist._isSeedArtist ? 0.90 : 0.60 + artist._moodScore * 0.35,
                    }));
            })
            .catch(() => [])
        )
    );

    const all = trackResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const sorted = deduplicate(all)
        .filter(t => t.id !== originalTrack.id)
        .sort((a, b) => b._similarity - a._similarity);

    console.log(`🎯 ${sorted.length} total candidates`);
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
