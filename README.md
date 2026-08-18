# OpenSubtitles Uploader

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/opensubtitles-dev/opensubtitles-com-uploader/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A subtitle uploader for **opensubtitles.com**, available as a desktop app and in the
browser. Drop video and subtitle files in, and it pairs them, detects languages,
calculates movie hashes, identifies titles, and uploads — all against the
opensubtitles.com REST API.

> **2.0.0 is a rewrite.** Every call now goes through the `.com` REST API; the legacy
> `.org` XML-RPC client has been removed entirely, and authentication is JWT-based.
> If you are looking for the original, see
> [opensubtitles-uploader-pro](https://github.com/opensubtitles/opensubtitles-uploader-pro).

## 📦 Downloads

**[Download the latest release](https://github.com/opensubtitles-dev/opensubtitles-com-uploader/releases/latest)**

- **Windows x64** — `.exe` installer
- **macOS** — universal `.dmg` (Intel & Apple Silicon)
- **Linux x64** — `.AppImage` and `.deb`

## ✨ Features

### Smart upload experience

- **Drag & drop** — drop files or whole directories
- **Automatic pairing** — matches videos to subtitles by filename similarity
- **Language detection** — identifies subtitle language automatically
- **Title recognition** — movie and episode detection with IMDb integration
- **Batch processing** — many pairs at once

### Intelligent automation

- **Video metadata extraction** — resolution, codec, bitrate, duration
- **Episode detection** — season/episode numbering, attaching to the episode rather than the series
- **Movie hash calculation** — OpenSubtitles-compatible hashes for precise matching
- **Automatic tagging** — HD, hearing impaired and foreign-parts flags inferred from filenames
- **Create-from-ID** — paste an IMDb or TMDb id and create a missing title without leaving the app
- **MKV subtitle extraction** — pulls embedded subtitle tracks out of MKV files

### User experience

- **Modern UI** — DaisyUI on Tailwind, with dark/light theme detection
- **Upload history** — review, edit and delete your uploads in-app
- **Performance** — caching, retry logic and parallel processing
- **Ad blocker detection** — warns and guides when a blocker interferes

## 🚀 Using it

1. **Open the app** — launch the desktop build, or run it in a browser
2. **Drop files** — videos and subtitles, or entire directories
3. **Let it work** — pairing, metadata extraction, hashing, language detection and title identification all run automatically
4. **Review and upload** — check what was detected, adjust anything, upload

### Supported formats

**Video** — `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.flv`, `.wmv`, and more

**Subtitles** — `.srt`, `.vtt`, `.ass`, `.ssa`, `.sub`, `.txt`, and more

### Browser compatibility

Works in Chrome, Firefox, Safari, Edge and Brave (disable Shields for the site).
If uploads misbehave, check the connectivity test page linked in the footer — ad
blockers are the usual cause.

## 🏗️ Development setup

### Prerequisites

- **Node.js 22+** and npm — the test script passes a glob to the built-in `node --test`
  runner, and glob expansion landed in Node 22
- An **opensubtitles.com API key** — [register as a consumer](https://www.opensubtitles.com/en/consumers)

### Install

```bash
git clone git@github.com:opensubtitles-dev/opensubtitles-com-uploader.git
cd opensubtitles-com-uploader
npm install
cp .env.example .env   # then fill in your keys
```

### Configuration

All configuration lives in `.env`. See `.env.example` for the annotated version.

| Variable                          | Purpose                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_OPENSUBTITLES_API_KEY_PROD` | Production API key. Required for any build that can reach production.                                                                                                                                                                  |
| `VITE_OPENSUBTITLES_API_KEY_DEV`  | API key for the dev backend. Only needed for builds that talk to it.                                                                                                                                                                   |
| `VITE_OPENSUBTITLES_BASE_URL`     | Base URL of the **dev** backend, e.g. `https://osdev.ngrok.dev/api/v1`. Leave unset and the dev environment is not selectable — the switch falls back to production, even if `VITE_ENV_SWITCH=true` or a stored preference says `dev`. |
| `VITE_ENV_SWITCH`                 | `true` shows the environment switch in the header. Leave unset for public builds.                                                                                                                                                      |

Production is **hard-wired** to `https://api.opensubtitles.com/api/v1` and is not
configurable — only the dev URL is. The `/api/v1` suffix is appended if you omit it,
and trailing slashes are stripped.

The legacy single-key variable `VITE_OPENSUBTITLES_API_KEY` is still accepted, but
**only** as a fallback for the dev key — never for production. A wrong key against
production fails at the API gateway, so that path is deliberately not silent.

### Running

```bash
npm run dev                       # web dev server, switch per .env
VITE_ENV_SWITCH=true npm run dev  # force the switch on for this run
npm run tauri:dev                 # desktop app
```

## 🔀 The environment switch

Builds made with `VITE_ENV_SWITCH=true` show a control in the header that switches
the backend between **Production** and **Dev (ngrok)**. It exists so remote testers
can exercise a dev backend without a toolchain, and compare against production.

Three things worth knowing:

- **Switching reloads the app.** The choice is persisted, then the window reloads so
  every module re-resolves the backend. Anything in flight — dropped files, detections
  — is lost, so pick your environment before you start work.
- **Sessions and caches are per-environment.** Logging in on production does not log
  you in on dev, and API responses cached from one backend are invisible to the other.
  Flip back and your previous session is still there.
- **Public builds ignore all of it.** With the flag unset, the app is hard-wired to
  production and ignores any stored preference — including one left behind by a tester
  build previously installed on the same machine.

Upgrading from a pre-2.0.0 build clears the old session once, because stored
credentials from before this change cannot be attributed to a backend. You log in again
the first time; after that it persists normally.

## 🖥️ Desktop builds

### Prerequisites

1. **Rust** (for Tauri):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```
2. **System dependencies**
   - **macOS** — none
   - **Windows** — [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - **Linux**:
     ```bash
     sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
     ```

### Building

```bash
# Tester build — switch visible, both keys embedded
VITE_ENV_SWITCH=true npm run tauri:build

# Public build — production only, no switch
npm run tauri:build
```

A tester build embeds the production key, so anyone with the binary can extract it.
That is the same exposure the public release already carries, but it does mean tester
builds should be shared by link rather than posted publicly.

> **Note on `npm run build`:** it chains `generate-changelog`, which regenerates
> `CHANGELOG.md` from this repository's GitHub releases. Until the fork publishes
> releases, that will empty the changelog. For a plain web build use `npx vite build`.

## 🧪 Testing

```bash
npm test              # unit suite — node --test
npm run lint
npm run format:check
```

The suite is unit-only and performs no network calls. Before a release, the manual
**production smoke test** in [`docs/plans/08-testing-strategy.md`](docs/plans/08-testing-strategy.md) §6
must pass: upload a subtitle for a known title, one for a title created from an IMDb id,
and one episode subtitle, then delete all three and confirm the rows are gone.

Staging is deliberately not a test target — it runs against the production database
with no sidekiq and no dedicated opensearch indexes, so uploads there are never properly
saved or indexed. The smoke test therefore runs against production, where test uploads
stay identifiable by source, date and the `v2.0.0` user-agent.

## 🚀 Releases

Follow this sequence exactly — the version must be committed before anything is built,
or the release ships files stamped with the previous version:

```bash
npm run update-version        # syncs package.json, constants.js, tauri.conf.json, Cargo.toml, README badge
npm run generate-changelog
git add . && git commit -m "🚀 RELEASE: Version X.X.X - Description"
git tag vX.X.X && git push && git push --tags
```

`.github/workflows/build-desktop-apps.yml` triggers automatically on a pushed `v*` tag,
so `git push --tags` above already starts the build — there is nothing further to run.
The workflow also accepts a manual `gh workflow run "Build Desktop Apps"` (its
`workflow_dispatch` trigger takes no inputs; a `--field` on that command is rejected),
which is useful for rebuilding the current `main` without a new tag, but a tagged push
is the normal release path.

Every release needs `latest.json` (the Tauri updater manifest) alongside the platform
installers — auto-updates break without it.

## 🏗️ Technical details

### Stack

- **React 18**, hooks-based
- **Vite** for dev server and builds
- **Tailwind CSS + DaisyUI 4**, with `lucide-react` icons
- **Tauri v2** for the desktop app

### API

Everything goes through the **opensubtitles.com REST API**
(`https://api.opensubtitles.com/api/v1`): authentication, title guessing, duplicate
checking, upload, and upload history. Requests carry an `Api-Key` header and, when
logged in, a JWT bearer token. Anonymous uploads are supported — the app simply omits
the authorization header.

### Project structure

```
src/
├── components/          # React components
│   ├── FileList/        # File listing
│   └── history/         # Upload history
├── config/
│   └── environments.js  # Backend registry, active-environment resolution
├── contexts/            # React contexts (auth, theme)
├── hooks/               # Custom hooks
├── services/
│   ├── api/             # REST client and per-resource services
│   └── ...              # Hashing, caching, file processing
└── utils/               # Constants, storage keys, helpers
```

## 🔒 Security

- **No secrets in the repo.** Keys come from `.env` locally. At build time Vite's
  `define` bakes them into the bundle as compile-time constants (`vite.config.js`),
  with an `import.meta.env` fallback for the dev server (`src/config/environments.js`).
  `src/utils/embeddedConstants.js` is also generated and gitignored, but nothing
  imports it — it is not part of the live key-delivery path.
- **Never log credentials.** Use `logSensitiveData()` from `src/utils/securityUtils.js`
  for anything token-shaped. Partial tokens count as exposure — do not log the first
  few characters of a key to "identify" it.
- **Per-environment isolation.** Tokens and cached API data are namespaced by backend,
  so a dev session can never be presented as a production one.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🆘 Support

- **API docs**: [api.opensubtitles.com](https://api.opensubtitles.com)
- **Issues**: [GitHub Issues](https://github.com/opensubtitles-dev/opensubtitles-com-uploader/issues)

## 🙏 Acknowledgments

- [OpenSubtitles.com](https://www.opensubtitles.com/) for the API platform and developer resources
- [React](https://reactjs.org/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/) and [DaisyUI](https://daisyui.com/)
- [Tauri](https://tauri.app/) for the desktop framework
