# Session Log

## 2026-03-10

### Recommendation engine overhaul
- Switched from `track.getSimilar` → `artist.getSimilar` + `artist.getTopTracks` as the candidate pool. Fixes the core problem where similar tracks for e.g. Stairway to Heaven were all hard rock and left no mood-matching results.
- Batched all Last.fm API calls (8–10 per batch) to reduce silent rate-limit failures.
- Hard-exclude non-mood-matching tracks (no more padding with bad recs).
- Fallback (genre search) now triggers only when Last.fm genuinely doesn't know the artist, not when mood filtering reduces the pool.
- Increased Last.fm similar track limit from 25 → 50, hydration from 20 → 40.

### Mood redesign
- Dropped **Romantic** mood. Tags redistributed: ballads/love/melancholic → Chill; slow jams/sensual → Smooth.
- Mood selection is now **single-choice** (radio behaviour) instead of multi-select.
- Expanded `MOOD_LASTFM_TAGS` with ~30 additional tags per mood based on Last.fm's top-1000 tag list.
- Generate button color reflects the selected mood.

### Iterative playlist building
- Playlist capped at **5 tracks** per generation.
- **"Take it further"** section appears after first generation: pick a new mood → "Add 5 more" seeds from a random current playlist track, excludes already-shown IDs.
- `/api/recommendations` now accepts `exclude_ids` param.
- `findSimilarTracks` accepts an `excludeIds` Set.

### Spotify playlist integration
- After saving, `savedPlaylistId` is stored.
- "Add 5 more" automatically pushes new tracks to the existing Spotify playlist if already saved. Shows a status link.
- `pushTracksToPlaylist` helper added.

### UI / fonts
- Replaced **Playfair Display + Spectral** (serif) with **Plus Jakarta Sans** across all weights.
- Kept DM Mono for monospace/accent elements.
- **Animated wave loader**: 3 vertical SVG paths wiggle left/right in a staggered cascade while recommendations fetch. Pure CSS, no performance impact.
- **Logo** now links to `/` (full reset to search screen).

### ROADMAP updates
- Several items from Save/Library and UI/Polish addressed this session (iterative building, auto-add to playlist, wave loader).
