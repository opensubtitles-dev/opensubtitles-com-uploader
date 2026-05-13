import React, { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, Search, Loader2, ChevronLeft, Edit3 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { uploadApi } from '../services/api/upload.js';

// ---------------------------------------------------------------------------
// Helpers — IMDb / TMDb id parsing
// ---------------------------------------------------------------------------

// Accepts: "tt11114492", "11114492", 11114492,
//          "https://www.imdb.com/title/tt11114492/?ref_=...".
// Returns "tt11114492" or null.
function parseImdbId(input) {
  if (input == null) return null;
  const s = String(input).trim();
  const urlMatch = s.match(/imdb\.com\/title\/(tt\d{7,10})/i);
  if (urlMatch) return urlMatch[1];
  const ttMatch = s.match(/^(tt\d{7,10})$/i);
  if (ttMatch) return ttMatch[1].toLowerCase();
  const numMatch = s.match(/^(\d{7,10})$/);
  if (numMatch) return `tt${numMatch[1]}`;
  return null;
}

// Accepts: "84958", 84958, "https://www.themoviedb.org/tv/84958-loki".
// Returns the integer id or null.
function parseTmdbId(input) {
  if (input == null) return null;
  const s = String(input).trim();
  const urlMatch = s.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1], 10);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * "Movie not in our database? Create a new entry" dialog.
 *
 * Two-step state machine per docs/plans/11-stub-feature-from-imdb-tmdb.md:
 *
 *   resolve    → user pastes imdb_id / tmdb_id / URL, click "Look up"
 *                → POST /features/from_id
 *                → confirming (or onCreated immediately if exists_in_db)
 *   confirming → display canonical title/year/type/poster (+ season/episode
 *                picker for tvshow with series graph)
 *                → POST /features/stub → onCreated(movieGuess, response)
 *   manual     → free-text fallback for content not on IMDb at all
 *
 * Caller contract unchanged: `onCreated(movieGuess, rawResponse)` receives
 * a guess-shaped hash so the rest of the upload flow can attach a subtitle
 * to the new feature_id without further plumbing.
 */
export function StubFeatureDialog({ initialTitle = '', onCreated, onCancel }) {
  const { isAuthenticated } = useAuth();

  // ── State machine ────────────────────────────────────────────────
  // If the caller hands us something that already looks like an id (or
  // empty input), start in `resolve`. If it's plain free-text (e.g. the
  // user typed "The Matrix" in MovieSearch and got 0 hits), jump to
  // `manual` with the title pre-filled — saves them a click.
  const initialStep = useMemo(() => {
    if (!initialTitle?.trim()) return 'resolve';
    return parseImdbId(initialTitle) || parseTmdbId(initialTitle) ? 'resolve' : 'manual';
  }, [initialTitle]);

  const [step, setStep] = useState(initialStep);
  const [idInput, setIdInput] = useState(
    parseImdbId(initialTitle) || parseTmdbId(initialTitle) ? initialTitle : ''
  );
  const [resolved, setResolved] = useState(null); // /from_id response body
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // tvshow series/episode picker selection
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);

  // Manual-mode form
  const [manualForm, setManualForm] = useState({ title: initialTitle, year: '', type: 'movie' });

  // When resolved data arrives, hydrate season/episode picker defaults.
  useEffect(() => {
    if (!resolved) return;
    if (resolved.preselected) {
      setSelectedSeason(resolved.preselected.season_number ?? null);
      setSelectedEpisode(resolved.preselected);
    } else if (resolved.type === 'tvshow' && resolved.series?.seasons?.length) {
      // Default to season 1 to surface a non-empty episode list.
      setSelectedSeason(resolved.series.seasons[0].season_number);
      setSelectedEpisode(null);
    }
  }, [resolved]);

  // ── Step transitions ─────────────────────────────────────────────

  const handleLookup = async e => {
    e.preventDefault();
    setError(null);

    const imdbId = parseImdbId(idInput);
    const tmdbId = imdbId ? null : parseTmdbId(idInput);
    if (!imdbId && !tmdbId) {
      setError('Paste an IMDb id (tt…) or TMDb id, or use Switch to manual below.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await uploadApi.resolveFromId({ imdbId, tmdbId });
      if (!r?.found) {
        setError('No match for that id.');
        return;
      }
      // exists_in_db → skip the confirm step entirely.
      if (r.exists_in_db && r.feature_id) {
        onCreated(restResponseToMovieGuess(r), r);
        return;
      }
      setResolved(r);
      setStep('confirming');
    } catch (err) {
      setError(humaniseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCreate = async () => {
    if (!resolved) return;
    setError(null);
    setSubmitting(true);
    try {
      // Branch by resolved.type. For tvshow the user must pick an episode
      // (uploads must NEVER target series-level — plan §9.1).
      if (resolved.type === 'tvshow') {
        if (!selectedEpisode) {
          setError('Pick a season and episode to upload against.');
          setSubmitting(false);
          return;
        }
        const result = await uploadApi.createStubFeature({
          title: selectedEpisode.title || resolved.title,
          year: selectedEpisode.year || resolved.year,
          type: 'episode',
        });
        onCreated(
          {
            ...restResponseToMovieGuess(resolved),
            kind: 'episode',
            season: selectedSeason,
            episode: selectedEpisode.episode_number,
            episode_imdbid: selectedEpisode.imdb_id,
            parent_imdbid: resolved.imdb_id,
            feature_id: result.feature_id,
            provisional: result.provisional,
          },
          result
        );
        return;
      }

      // Movie path.
      const result = await uploadApi.createStubFeature({
        title: resolved.title,
        year: resolved.year,
        type: 'movie',
      });
      onCreated(
        {
          ...restResponseToMovieGuess(resolved),
          feature_id: result.feature_id,
          provisional: result.provisional,
        },
        result
      );
    } catch (err) {
      setError(humaniseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSubmit = async e => {
    e.preventDefault();
    setError(null);
    if (!manualForm.title.trim()) return;
    setSubmitting(true);
    try {
      const yearInt = manualForm.year ? parseInt(manualForm.year, 10) : undefined;
      const result = await uploadApi.createStubFeature({
        title: manualForm.title.trim(),
        year: Number.isFinite(yearInt) ? yearInt : undefined,
        type: manualForm.type,
      });
      onCreated(
        {
          imdbid: null,
          title: result.title || manualForm.title.trim(),
          year: result.year || yearInt || null,
          kind: (result.type || manualForm.type).toLowerCase(),
          reason: 'User created provisional entry',
          feature_id: result.feature_id,
          provisional: true,
        },
        result
      );
    } catch (err) {
      setError(humaniseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={e => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div className="modal-box w-full max-w-lg bg-base-100 p-6 space-y-3">
        {step === 'resolve' && (
          <>
            <h2 className="text-lg font-semibold text-base-content">Create new entry</h2>
            <p className="text-sm text-base-content/70">
              The movie or show isn't in our database yet. Paste an IMDb or TMDb id and we'll
              fetch the canonical title for confirmation.
            </p>
          </>
        )}

        {step === 'confirming' && resolved && (
          <h2 className="text-lg font-semibold text-base-content">Confirm new entry</h2>
        )}

        {step === 'manual' && (
          <>
            <h2 className="text-lg font-semibold text-base-content">Create new entry (manual)</h2>
            <p className="text-sm text-base-content/70">
              For content not listed on IMDb or TMDb. A moderator will review the entry.
            </p>
          </>
        )}

        {!isAuthenticated && (
          <div role="alert" className="alert alert-warning">
            <AlertTriangle className="size-5 shrink-0" />
            <span>You need to be logged in to create a new entry.</span>
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <AlertTriangle className="size-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* RESOLVE STEP */}
        {step === 'resolve' && (
          <form onSubmit={handleLookup} className="space-y-3">
            <div>
              <label
                htmlFor="stub_id_input"
                className="block text-sm font-medium text-base-content mb-1"
              >
                IMDb or TMDb id <span className="text-error">*</span>
              </label>
              <input
                id="stub_id_input"
                type="text"
                autoFocus
                required
                value={idInput}
                onChange={e => setIdInput(e.target.value)}
                placeholder="tt11114492, 11114492, https://www.imdb.com/title/tt11114492/"
                className="input input-bordered w-full"
              />
              <p className="text-xs text-base-content/60 mt-1">
                Accepted: tt-prefixed id, bare number, full IMDb URL, or a TMDb URL/id.
              </p>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                className="text-xs text-base-content/60 hover:underline flex items-center gap-1"
                onClick={() => {
                  setStep('manual');
                  setError(null);
                }}
              >
                <Edit3 className="size-3" />
                Switch to manual entry
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={submitting}
                  className="btn btn-sm btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isAuthenticated}
                  className="btn btn-sm btn-primary gap-2"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  {submitting ? 'Looking up…' : 'Look up'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* CONFIRMING STEP */}
        {step === 'confirming' && resolved && (
          <div className="space-y-3">
            <div className="flex gap-3">
              {resolved.poster_url && (
                <img
                  src={resolved.poster_url}
                  alt=""
                  className="w-20 h-auto rounded-md border border-base-300"
                />
              )}
              <div className="flex-1 text-sm space-y-0.5">
                <div className="font-semibold text-base-content">{resolved.title}</div>
                {resolved.original_title && resolved.original_title !== resolved.title && (
                  <div className="text-base-content/60 italic">{resolved.original_title}</div>
                )}
                <div className="text-base-content/70">
                  {resolved.year ? `${resolved.year} · ` : ''}
                  {resolved.type === 'tvshow' ? 'TV show' : resolved.type}
                </div>
                {resolved.imdb_id && (
                  <div className="text-xs text-base-content/60">
                    IMDb: <code>{resolved.imdb_id}</code>
                  </div>
                )}
              </div>
            </div>

            {/* Season / Episode picker for tv content (plan §9.1 — uploads
                must NEVER target a series at series level). */}
            {resolved.type === 'tvshow' && resolved.series?.seasons?.length > 0 && (
              <div className="border border-base-300 rounded-md p-3 space-y-2 bg-base-200/40">
                <div className="text-sm font-medium text-base-content">
                  Pick the episode this subtitle is for
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-base-content/70 mb-0.5">Season</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={selectedSeason ?? ''}
                      onChange={e => {
                        const n = parseInt(e.target.value, 10);
                        setSelectedSeason(Number.isFinite(n) ? n : null);
                        setSelectedEpisode(null);
                      }}
                    >
                      {resolved.series.seasons.map(s => (
                        <option key={s.season_number} value={s.season_number}>
                          Season {s.season_number} ({s.episode_count} eps)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-base-content/70 mb-0.5">Episode</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={selectedEpisode?.imdb_id ?? ''}
                      onChange={e => {
                        const seasonObj = resolved.series.seasons.find(
                          s => s.season_number === selectedSeason
                        );
                        const ep = seasonObj?.episodes.find(x => x.imdb_id === e.target.value);
                        setSelectedEpisode(ep ?? null);
                      }}
                    >
                      <option value="">— Select episode —</option>
                      {(
                        resolved.series.seasons.find(s => s.season_number === selectedSeason)
                          ?.episodes ?? []
                      ).map(ep => (
                        <option key={ep.imdb_id} value={ep.imdb_id}>
                          E{ep.episode_number} — {ep.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {resolved.preselected && (
                  <div className="text-xs text-success">
                    Pre-selected from the episode you searched.
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('resolve');
                  setResolved(null);
                  setError(null);
                }}
                disabled={submitting}
                className="btn btn-sm btn-ghost gap-1"
              >
                <ChevronLeft className="size-4" />
                Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={submitting}
                  className="btn btn-sm btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCreate}
                  disabled={
                    submitting ||
                    !isAuthenticated ||
                    (resolved.type === 'tvshow' && !selectedEpisode)
                  }
                  className="btn btn-sm btn-primary gap-2"
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitting ? 'Creating…' : 'Looks right — create entry'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MANUAL STEP */}
        {step === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="manual_title"
                className="block text-sm font-medium text-base-content mb-1"
              >
                Title <span className="text-error">*</span>
              </label>
              <input
                id="manual_title"
                type="text"
                required
                autoFocus
                value={manualForm.title}
                onChange={e => setManualForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. My Indie Documentary"
                className="input input-bordered w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="manual_year"
                  className="block text-sm font-medium text-base-content mb-1"
                >
                  Year
                </label>
                <input
                  id="manual_year"
                  type="number"
                  min="1888"
                  max="2100"
                  value={manualForm.year}
                  onChange={e => setManualForm(f => ({ ...f, year: e.target.value }))}
                  placeholder={String(new Date().getFullYear())}
                  className="input input-bordered w-full"
                />
              </div>
              <div>
                <label
                  htmlFor="manual_type"
                  className="block text-sm font-medium text-base-content mb-1"
                >
                  Type
                </label>
                <select
                  id="manual_type"
                  value={manualForm.type}
                  onChange={e => setManualForm(f => ({ ...f, type: e.target.value }))}
                  className="select select-bordered w-full"
                >
                  <option value="movie">Movie</option>
                  <option value="tvshow">TV show</option>
                  <option value="episode">Episode</option>
                </select>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                className="text-xs text-base-content/60 hover:underline flex items-center gap-1"
                onClick={() => {
                  setStep('resolve');
                  setError(null);
                }}
              >
                <ChevronLeft className="size-3" />
                Back to id lookup
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={submitting}
                  className="btn btn-sm btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isAuthenticated || !manualForm.title.trim()}
                  className="btn btn-sm btn-primary"
                >
                  {submitting ? 'Creating…' : 'Create entry'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — response → movieGuess shape
// ---------------------------------------------------------------------------

// Mirror what /guess returns so the upstream upload flow can treat the
// new feature like any other matched movie.
function restResponseToMovieGuess(r) {
  return {
    imdbid: r.imdb_id || null,
    tmdbid: r.tmdb_id || null,
    title: r.title,
    year: r.year || null,
    kind: (r.type || 'movie').toLowerCase(),
    reason: r.exists_in_db
      ? 'Matched existing entry by IMDb/TMDb id'
      : 'User confirmed entry from IMDb/TMDb id',
    feature_id: r.feature_id || null,
    provisional: !r.exists_in_db,
    poster_url: r.poster_url || null,
  };
}

function humaniseError(err) {
  if (err?.code === 'unauthorized' || err?.status === 401) {
    return 'You must be logged in to create a new entry.';
  }
  if (err?.code === 'imdb_id_not_found' || err?.code === 'tmdb_id_not_found') {
    return 'No match for that id. Double-check it, or use Switch to manual.';
  }
  if (err?.code === 'invalid_imdb_id') {
    return "That doesn't look like a valid IMDb id (expecting tt-prefixed digits).";
  }
  if (err?.code === 'invalid_tmdb_id') {
    return "That doesn't look like a valid TMDb id (expecting a positive integer).";
  }
  if (err?.code === 'missing_id') {
    return 'Provide an IMDb id or a TMDb id.';
  }
  return err?.message || 'Lookup failed. Try again or use manual entry.';
}
