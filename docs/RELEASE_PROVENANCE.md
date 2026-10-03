# Release provenance

Backend and frontend builds record only `commitSha` and `buildTimestamp`. The shared resolver is `backend/src/common/release/release-build.ts`. It accepts a full SHA from `RELEASE_SHA`, `RENDER_GIT_COMMIT`, or `GITHUB_SHA`; supplied sources must agree. Invalid values fail with a safe error that names the field without printing its contents. No Git command or branch HEAD fallback is used. A source-less local build records `unknown` explicitly. CI verification fails when its source is absent.

`RELEASE_BUILD_TIMESTAMP` may supply an ISO UTC timestamp for paired builds. Otherwise each artifact records its actual build time. Timestamp equality is unnecessary for separately built services; report each value and require their SHA to equal the tested release SHA. Build time is never replaced by process startup time.

The backend build writes `backend/dist/release-metadata.json`. Startup reads this immutable artifact, logs the allowlisted release object in `application.started`, and adds the actual `process.version` as `runtimeNodeVersion`. `GET /api/v1/health/version` returns these same three fields in the existing `{ data, meta }` API envelope without database/Redis calls. Runtime environment values cannot replace the baked identity. Missing metadata in an unbuilt development process is explicitly `unknown`; a corrupt existing artifact fails safely.

The frontend build embeds its metadata into JavaScript, logs it once as `Frontend release`, and emits `frontend/dist/release.json` at `/release.json`. It reads provenance from process build environment, without exposing other environment values. Static hosting/browser execution has no Node runtime field.

[Render default environment documentation](https://render.com/docs/environment-variables) identifies `RENDER_GIT_COMMIT` as the service/deploy SHA and makes it available at build and runtime. Native Render builds consume it directly. Docker builds declare SHA build ARGs; CI container builds validate all supplied sources with the shared resolver before choosing the image tag, and pass those sources plus a shared timestamp. Missing CI identity or conflicting SHA sources fail before building. The npm resolver version comes from root `packageManager`, including Docker dependency installation.

CI runs `node --experimental-strip-types --test deploy/release-provenance.test.mjs`, then `node deploy/ci/check-release-provenance.mjs` after production builds. The latter checks both artifact SHAs against the supplied CI source, safe fields and valid build timestamps. Production API smoke verifies health/version and startup metadata against the built artifact. HTTPS proxy smoke separately verifies the live backend and frontend identities against the supplied release SHA.

For a later authorized deploy, retain the tested CI SHA, read backend `/api/v1/health/version` and frontend `/release.json`, and record each service separately. Accept identity only when `CI tested SHA = backend Live SHA = frontend Live SHA`. `unknown`, a service mismatch, or stale artifact metadata is insufficient evidence. This task does not deploy and does not establish the identity of existing staging services.

For a future **native Render build**, install the npm version declared by root `packageManager` before installing the lockfile. The old native build command alone does not select the fixed npm resolver. With repository root as the build working directory, use:

```bash
npm install --global "$(node -p 'require("./package.json").packageManager')"
npm ci --include=dev
npm run build --workspace backend
```

Use `--workspace frontend` for the separate frontend service. Configure `SKIP_INSTALL_DEPS=true` to prevent Render's preliminary automatic dependency installation from using a different resolver; keep Node 22 selected. These are instructions for the next authorized deployment, not runtime changes performed in this task. Render documents [SKIP_INSTALL_DEPS](https://render.com/docs/environment-variables#skip_install_deps) and [installing tools in the build command](https://render.com/docs/troubleshooting-deploys#configuration-mismatches). Neither build command runs migrations. `RENDER_GIT_COMMIT` supplies identity; do not replace it with a branch-head lookup.

The canonical CI builds production artifacts after Playwright: the browser suite runs Nest in watch mode, which clears `backend/dist`. Building afterward ensures the startup smoke and version checks consume the final production artifact, including its immutable metadata.
