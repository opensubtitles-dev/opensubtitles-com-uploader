import React, { useState } from 'react';
import { useMovieSearch } from '../hooks/useMovieSearch.js';
import { StubFeatureDialog } from './StubFeatureDialog.jsx';

export const MovieSearch = ({
  isOpen,
  onMovieChange,
  onClose,
  itemPath,
  movieUpdateLoading,
  themeColors,
  isDark,
}) => {
  const {
    movieSearchQuery,
    movieSearchResults,
    movieSearchLoading,
    handleMovieSearch,
    handleMovieSelect,
    isImdbInput,
    pendingResolvedFeature,
    acceptResolvedFeatureGuess,
    clearPendingResolvedFeature,
  } = useMovieSearch(onMovieChange);

  const [stubOpen, setStubOpen] = useState(false);
  const trimmedSearchQuery = movieSearchQuery.trim();
  const searchQueryLooksLikeImdbId = isImdbInput(trimmedSearchQuery);

  const movieRequiresConfirmation = movie => {
    if ((movie?.kind || '').toLowerCase() === 'tvshow') return true;
    const envelope = movie?._resolveEnvelope;
    return Boolean(envelope?.found && !(envelope.exists_in_db && envelope.feature_id));
  };

  const handleSearchResultClick = async movie => {
    await handleMovieSelect(itemPath, movie);
    if (!movieRequiresConfirmation(movie)) onClose?.();
  };

  if (!isOpen) return null;

  return (
    <div
      className="mt-3 p-3 rounded-lg"
      style={{
        backgroundColor: themeColors.cardBackground,
        border: `1px solid ${themeColors.border}`,
      }}
      data-movie-search
    >
      <div className="text-sm mb-2" style={{ color: themeColors.text }}>
        Search by movie title, IMDb ID, or IMDb URL:
      </div>
      <input
        type="text"
        placeholder="Movie title, IMDb ID (tt0133093), or IMDb URL..."
        value={movieSearchQuery}
        onChange={e => handleMovieSearch(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded border focus:outline-none focus:ring-2 transition-colors"
        style={{
          backgroundColor: themeColors.background,
          borderColor: themeColors.border,
          color: themeColors.text,
          focusRingColor: themeColors.primary,
        }}
        onFocus={e => {
          e.target.style.borderColor = themeColors.primary;
          e.target.style.boxShadow = `0 0 0 2px ${themeColors.primary}20`;
        }}
        onBlur={e => {
          e.target.style.borderColor = themeColors.border;
          e.target.style.boxShadow = 'none';
        }}
        autoFocus
      />

      {movieSearchLoading && (
        <div
          className="mt-2 text-sm flex items-center gap-2"
          style={{ color: themeColors.textMuted }}
        >
          <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
          Searching...
        </div>
      )}

      {movieSearchResults.length > 0 && (
        <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {movieSearchResults.map((movie, index) => (
            <button
              key={movie.id || index}
              onClick={() => handleSearchResultClick(movie)}
              disabled={movieUpdateLoading?.[itemPath]}
              className="w-full text-left p-2 rounded text-sm border transition-colors hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: themeColors.background,
                borderColor: themeColors.border,
                color: themeColors.text,
              }}
              onMouseEnter={e => {
                if (!movieUpdateLoading?.[itemPath]) {
                  e.target.style.backgroundColor = isDark ? '#444444' : '#f8f9fa';
                }
              }}
              onMouseLeave={e => {
                e.target.style.backgroundColor = themeColors.background;
              }}
            >
              <div className="flex items-center gap-3">
                {movieUpdateLoading?.[itemPath] ? (
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
                ) : (
                  <>
                    {movie.pic ? (
                      <img
                        src={movie.pic}
                        alt={movie.name || movie.title || 'Movie poster'}
                        className="w-8 h-12 object-cover rounded"
                        style={{ border: `1px solid ${themeColors.border}` }}
                        onError={e => (e.target.style.display = 'none')}
                      />
                    ) : (
                      <span>🎬</span>
                    )}
                  </>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {/* Enhanced display for episodes with parent series information */}
                    {movie.kind === 'episode' && (movie.parent_title || movie.series_title) ? (
                      <>
                        <span style={{ color: themeColors.primary || themeColors.link }}>
                          {movie.parent_title || movie.series_title}
                        </span>
                        {(movie.season_number || movie.episode_number) && (
                          <span style={{ color: themeColors.textSecondary }}>
                            {' - '}
                            {movie.season_number &&
                              `S${movie.season_number.toString().padStart(2, '0')}`}
                            {movie.episode_number &&
                              `E${movie.episode_number.toString().padStart(2, '0')}`}
                          </span>
                        )}
                        {(movie.name || movie.title) && (
                          <span style={{ color: themeColors.text }}>
                            {' '}
                            - {movie.name || movie.title}
                          </span>
                        )}
                        {movie.year && ` (${movie.year})`}
                      </>
                    ) : (
                      <>
                        {movie.name || movie.title || 'Unknown Title'}
                        {movie.year && ` (${movie.year})`}
                      </>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: themeColors.textMuted }}>
                    {movie.kind && `${movie.kind} • `}
                    IMDb: {movie.id || movie.imdbid || 'N/A'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {trimmedSearchQuery && !movieSearchLoading && movieSearchResults.length === 0 && (
        <div
          className="mt-2 text-sm text-center py-4 space-y-2"
          style={{ color: themeColors.textMuted }}
        >
          <div>
            {searchQueryLooksLikeImdbId
              ? 'No title found for that IMDb ID.'
              : 'No local database match for that title.'}
          </div>
          <div className="text-xs">
            Create a linked entry by looking it up with an IMDb or TMDb ID first.
          </div>
          <button
            type="button"
            onClick={() => setStubOpen(true)}
            className="text-sm underline"
            style={{ color: themeColors.primary || themeColors.link }}
          >
            {searchQueryLooksLikeImdbId
              ? 'Look up/create from this ID →'
              : 'Look up by IMDb/TMDb ID →'}
          </button>
        </div>
      )}

      <div className="mt-2 text-xs" style={{ color: themeColors.textSecondary }}>
        Examples: "The Matrix", "133093", "0133093", "tt0133093",
        "https://www.imdb.com/title/tt0133093/"
      </div>

      {stubOpen && (
        <StubFeatureDialog
          initialTitle={searchQueryLooksLikeImdbId ? trimmedSearchQuery : ''}
          manualTitleSuggestion={searchQueryLooksLikeImdbId ? '' : trimmedSearchQuery}
          preferIdLookup
          onCreated={async movieGuess => {
            setStubOpen(false);
            await handleMovieSelect(itemPath, movieGuess);
            onClose?.();
          }}
          onCancel={() => setStubOpen(false)}
        />
      )}

      {/* External IMDb/TMDb result not yet in DB → confirm and create it
          before accepting it as upload-ready. Tvshows also use this path to
          force an episode pick, so uploads never carry a bare show imdb_id. */}
      {pendingResolvedFeature && (
        <StubFeatureDialog
          initialResolved={pendingResolvedFeature.envelope}
          onCreated={async movieGuess => {
            await acceptResolvedFeatureGuess(pendingResolvedFeature.itemPath, movieGuess);
            onClose?.();
          }}
          onCancel={clearPendingResolvedFeature}
        />
      )}
    </div>
  );
};
