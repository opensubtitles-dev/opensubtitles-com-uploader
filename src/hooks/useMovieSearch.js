import React from 'react';
import { featuresApi } from '../services/api/features.js';
import { uploadApi } from '../services/api/upload.js';

/**
 * Shared movie search hook for both MatchedPairs and OrphanedSubtitles
 * Provides consistent movie search functionality across components.
 *
 * Backend: GET /api/v1/features (replaces legacy
 * https://www.opensubtitles.org/libs/suggest_imdb.php).
 * See docs/plans/02-endpoint-mapping.md §E6 + §E7.
 *
 * IMDb-id input is special-cased: instead of hitting the Searchkick-backed
 * `/features?imdb_id=…` endpoint (which can miss freshly-imported rows),
 * we call `/subtitles/upload/features/from_id` which does an unscoped
 * `Feature.find_by(imdbid: …)` and additionally returns the season/episode
 * graph for tvshow features. This makes id-pasted lookups deterministic
 * AND wires the result into the tvshow → episode-picker flow.
 */
export const useMovieSearch = onMovieChange => {
  const [openMovieSearch, setOpenMovieSearch] = React.useState(null);
  const [movieSearchQuery, setMovieSearchQuery] = React.useState('');
  const [movieSearchResults, setMovieSearchResults] = React.useState([]);
  const [movieSearchLoading, setMovieSearchLoading] = React.useState(false);
  const [movieUpdateLoading, setMovieUpdateLoading] = React.useState({});

  // When the user picks an external IMDb/TMDb result that is not yet a
  // persisted Feature, stash the resolve-envelope here and let MovieSearch
  // open StubFeatureDialog in confirming-mode. That dialog calls
  // /features/stub before we accept the selection as upload-ready.
  // Tvshows use the same path so the user picks a season+episode; uploads
  // must never target the series level (plan §9.1).
  const [pendingResolvedFeature, setPendingResolvedFeature] = React.useState(null);

  // Clear search state when closing
  const closeMovieSearch = () => {
    setOpenMovieSearch(null);
    setMovieSearchQuery('');
    setMovieSearchResults([]);
  };

  // Utility function to extract IMDB ID from various input formats
  const extractImdbId = input => {
    if (!input) return null;

    // Remove whitespace
    const trimmed = input.trim();

    // Match full IMDB URLs: https://www.imdb.com/title/tt1133589/
    const urlMatch = trimmed.match(/imdb\.com\/title\/(tt\d+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }

    // Match tt + number format: tt1133589
    const ttMatch = trimmed.match(/^(tt\d+)$/i);
    if (ttMatch) {
      return ttMatch[1];
    }

    // Match just numbers (assume it needs tt prefix): 1133589 or 749451
    const numberMatch = trimmed.match(/^\d+$/);
    if (numberMatch) {
      const number = parseInt(numberMatch[0], 10);

      // For numbers >= 3000, pad to 7 digits with leading zeros
      // This handles cases like 749451 -> tt0749451
      if (number >= 3000) {
        const paddedNumber = number.toString().padStart(7, '0');
        return `tt${paddedNumber}`;
      }

      // For smaller numbers, use as-is (legacy behavior)
      return `tt${numberMatch[0]}`;
    }

    return null;
  };

  // Check if input looks like an IMDB ID
  const isImdbInput = input => {
    return extractImdbId(input) !== null;
  };

  // Convert a /upload/features/from_id envelope into a single dropdown row
  // (shape compatible with normalizeFeatureForUi). The `_resolveEnvelope`
  // hidden field carries the original payload so handleMovieSelect can force
  // Feature creation when the id resolves externally but is not in our DB yet.
  const envelopeToSearchRow = envelope => {
    if (!envelope || !envelope.found) return null;
    const ttId = envelope.imdb_id || null;
    return {
      id: ttId,
      name: envelope.title || '',
      title: envelope.title || '',
      original_title: envelope.original_title || '',
      year: envelope.year != null ? Number(envelope.year) : null,
      kind: (envelope.type || '').toLowerCase(),
      feature_id: envelope.feature_id != null ? Number(envelope.feature_id) : null,
      imdb_id: ttId ? Number(String(ttId).replace(/^tt/i, '')) : null,
      tmdb_id: envelope.tmdb_id != null ? Number(envelope.tmdb_id) : null,
      img_url: envelope.poster_url || '',
      url: '',
      parent_imdb_id: null,
      season_number: envelope.preselected?.season_number ?? null,
      episode_number: envelope.preselected?.episode_number ?? null,
      _resolveEnvelope: envelope,
    };
  };

  // Debounced movie search — hits .com REST /features endpoint (text query)
  // or /upload/features/from_id (imdb id input).
  React.useEffect(() => {
    if (!movieSearchQuery.trim()) {
      setMovieSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      setMovieSearchLoading(true);
      try {
        const query = movieSearchQuery.trim();
        const imdbId = extractImdbId(query);

        if (imdbId) {
          // ID path — resolveFromId handles DB hits AND TMDb fallback in
          // one call, and ships the series graph for tvshow rows.
          try {
            const envelope = await uploadApi.resolveFromId(
              { imdbId },
              { signal: controller.signal }
            );
            const row = envelopeToSearchRow(envelope);
            setMovieSearchResults(row ? [row] : []);
          } catch (err) {
            if (err?.name === 'AbortError') return;
            // 404 / 422 → just show "no results"; not_found is normal UX
            const code = err?.code || err?.details?.error;
            if (
              code === 'imdb_id_not_found' ||
              code === 'invalid_imdb_id' ||
              code === 'missing_id'
            ) {
              setMovieSearchResults([]);
            } else {
              console.error('Movie search (imdb) error:', err);
              setMovieSearchResults([]);
            }
          }
        } else {
          // Text path — unchanged.
          const { data } = await featuresApi.searchByQuery(query, {
            signal: controller.signal,
          });
          setMovieSearchResults(data);
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Movie search error:', error);
          setMovieSearchResults([]);
        }
      } finally {
        setMovieSearchLoading(false);
      }
    }, 300); // 300ms debounce

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [movieSearchQuery]);

  // Click outside to close movie search
  React.useEffect(() => {
    const handleClickOutside = event => {
      if (openMovieSearch && !event.target.closest('[data-movie-search]')) {
        closeMovieSearch();
      }
    };

    if (openMovieSearch) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openMovieSearch]);

  // Handle opening movie search
  const handleOpenMovieSearch = React.useCallback(
    itemPath => {
      setOpenMovieSearch(openMovieSearch === itemPath ? null : itemPath);
    },
    [openMovieSearch]
  );

  // Handle movie search input
  const handleMovieSearch = query => {
    setMovieSearchQuery(query);
  };

  // Lazy-resolve a tvshow row that came from text search (no envelope yet).
  // Returns the envelope or null on failure.
  const resolveTvshowEnvelope = async movie => {
    if (movie?._resolveEnvelope) return movie._resolveEnvelope;
    const imdbInput = movie?.id || movie?.imdbid;
    if (!imdbInput) return null;
    try {
      return await uploadApi.resolveFromId({ imdbId: imdbInput });
    } catch (err) {
      console.error('Failed to resolve tvshow envelope:', err);
      return null;
    }
  };

  // Handle movie selection — accepts EITHER shape:
  //   - search-result shape from `normalizeFeatureForUi` / envelopeToSearchRow:
  //       { id: "tt0133093", name: "The Matrix", year, kind, feature_id,
  //         _resolveEnvelope? }
  //   - movieGuess shape from StubFeatureDialog's onCreated:
  //       { imdbid: "tt0056869", title: "The Birds", year, kind, feature_id, ... }
  // Search rows may also contain `title`, so detect the explicit search-row
  // shape first. Otherwise normal /features selections lose their `id`.
  const handleMovieSelect = async (itemPath, movie) => {
    const isSearchResultShape =
      movie?.id != null || movie?.name != null || movie?._resolveEnvelope != null;
    const isGuessShape = !isSearchResultShape && (movie?.imdbid != null || movie?.title != null);

    const openResolvedFeatureDialog = async envelope => {
      closeMovieSearch();
      setMovieUpdateLoading(prev => ({ ...prev, [itemPath]: true }));
      try {
        if (envelope && envelope.found) {
          setPendingResolvedFeature({ itemPath, envelope });
        }
      } finally {
        setMovieUpdateLoading(prev => ({ ...prev, [itemPath]: false }));
      }
    };

    // Tvshow → ALWAYS open the episode picker. Never let a bare show
    // imdb_id propagate as the final upload target.
    const kindStr = (movie?.kind || '').toLowerCase();
    if (!isGuessShape && kindStr === 'tvshow') {
      const envelope = await resolveTvshowEnvelope(movie);
      if (envelope && envelope.found) {
        await openResolvedFeatureDialog(envelope);
      } else {
        // Couldn't resolve — fall back to old behaviour so the user
        // isn't blocked, but log loudly.
        console.warn('Tvshow selected but resolveFromId returned no envelope', movie);
      }
      return;
    }

    // IMDb/TMDb lookup result not yet persisted in our DB → require the
    // confirm/create step first. Otherwise upload would send idmovieimdb and
    // the backend would reject with "No feature found for IMDb ID".
    const resolveEnvelope = movie?._resolveEnvelope;
    if (
      !isGuessShape &&
      resolveEnvelope?.found &&
      !(resolveEnvelope.exists_in_db && resolveEnvelope.feature_id)
    ) {
      await openResolvedFeatureDialog(resolveEnvelope);
      return;
    }

    // Close search interface
    closeMovieSearch();

    // Set loading state
    setMovieUpdateLoading(prev => ({ ...prev, [itemPath]: true }));

    try {
      const newMovieGuess = isGuessShape
        ? {
            // Pass guess-shape through, preserving feature_id / tmdb_id /
            // provisional / poster_url so the upload pipeline can use the
            // freshly created stub feature without another lookup.
            imdbid: movie.imdbid ?? null,
            title: movie.title ?? movie.name ?? '',
            year: movie.year ?? null,
            kind: movie.kind ?? '',
            reason: movie.reason ?? 'User selected',
            feature_id: movie.feature_id ?? null,
            tmdb_id: movie.tmdb_id ?? movie.tmdbid ?? null,
            provisional: movie.provisional ?? false,
            poster_url: movie.poster_url ?? movie.img_url ?? null,
            // Episode-coords carry-through (when dialog produced an episode).
            season_number: movie.season ?? movie.season_number ?? null,
            episode_number: movie.episode ?? movie.episode_number ?? null,
            episode_imdbid: movie.episode_imdbid ?? null,
            parent_imdbid: movie.parent_imdbid ?? null,
          }
        : {
            imdbid: movie.id || movie.imdbid || null,
            title: movie.name || movie.title || '',
            year: movie.year,
            kind: movie.kind,
            reason: 'User selected',
            feature_id: movie.feature_id ?? null,
            tmdb_id: movie.tmdb_id ?? movie.tmdbid ?? null,
            poster_url: movie.img_url ?? null,
          };

      // Call the parent component's movie change handler
      if (onMovieChange) {
        await onMovieChange(itemPath, newMovieGuess);
      }

      console.log('Movie updated successfully:', newMovieGuess);
    } catch (error) {
      console.error('Error updating movie:', error);
    } finally {
      // Clear loading state
      setMovieUpdateLoading(prev => ({ ...prev, [itemPath]: false }));
    }
  };

  // Called by MovieSearch after StubFeatureDialog returns a movieGuess shape
  // created from /features/stub. Just forwards through the normal
  // handleMovieSelect → onMovieChange path.
  const acceptResolvedFeatureGuess = async (itemPath, movieGuess) => {
    setPendingResolvedFeature(null);
    await handleMovieSelect(itemPath, movieGuess);
  };

  const clearPendingResolvedFeature = () => {
    setPendingResolvedFeature(null);
  };

  return {
    // State
    openMovieSearch,
    movieSearchQuery,
    movieSearchResults,
    movieSearchLoading,
    movieUpdateLoading,
    pendingResolvedFeature,

    // Actions
    handleOpenMovieSearch,
    handleMovieSearch,
    handleMovieSelect,
    closeMovieSearch,
    acceptResolvedFeatureGuess,
    clearPendingResolvedFeature,

    // Utilities
    extractImdbId,
    isImdbInput,
  };
};
