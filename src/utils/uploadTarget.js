const isPresent = value => value !== undefined && value !== null && value !== '';

const firstPresent = (...values) => values.find(isPresent) ?? null;

const normalizePositiveNumber = value => {
  if (!isPresent(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const normalizeImdbId = value => {
  if (!isPresent(value)) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
};

const normalizeOrdinal = value => {
  if (!isPresent(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

export function buildUploadTarget(movieData, bestMovieData = null) {
  const source = bestMovieData || movieData || {};
  const fallback = movieData || {};

  const featureId = normalizePositiveNumber(
    firstPresent(source.feature_id, source.featureId, fallback.feature_id, fallback.featureId)
  );
  const imdbId = normalizeImdbId(
    firstPresent(
      source.kind === 'episode' ? source.imdbid : null,
      source.imdbid,
      source.imdb_id,
      source.episode_imdbid,
      fallback.kind === 'episode' ? fallback.imdbid : null,
      fallback.imdbid,
      fallback.imdb_id,
      fallback.episode_imdbid
    )
  );
  const tmdbId = normalizePositiveNumber(
    firstPresent(source.tmdbid, source.tmdb_id, fallback.tmdbid, fallback.tmdb_id)
  );
  const seasonNumber = normalizeOrdinal(
    firstPresent(source.season_number, source.season, fallback.season_number, fallback.season)
  );
  const episodeNumber = normalizeOrdinal(
    firstPresent(source.episode_number, source.episode, fallback.episode_number, fallback.episode)
  );

  const payload = {};
  let primaryKey = null;
  let primaryValue = null;

  if (featureId) {
    payload.feature_id = featureId;
    primaryKey = 'feature_id';
    primaryValue = featureId;
  } else if (imdbId) {
    payload.idmovieimdb = imdbId;
    primaryKey = 'idmovieimdb';
    primaryValue = imdbId;
  } else if (tmdbId) {
    payload.tmdbid = tmdbId;
    primaryKey = 'tmdbid';
    primaryValue = tmdbId;
  }

  if (primaryKey && seasonNumber !== null && episodeNumber !== null) {
    payload.season_number = seasonNumber;
    payload.episode_number = episodeNumber;
  }

  return {
    payload,
    hasTarget: primaryKey !== null,
    primaryKey,
    primaryValue,
    feature_id: featureId,
    idmovieimdb: imdbId,
    tmdbid: tmdbId,
    season_number: seasonNumber,
    episode_number: episodeNumber,
  };
}

export function describeUploadTarget(target) {
  if (!target?.hasTarget) return 'none';
  return `${target.primaryKey}=${target.primaryValue}`;
}
