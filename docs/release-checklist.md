# Release Checklist

Use this before publishing a new npm version.

## Package Smoke Test

1. Run `npm run -s build`.
2. Run `npm test -- --run`.
3. Run `npm pack --dry-run` and confirm `dist/`, `bin/`, and `assets/` are included.
4. Run `npm pack`.
5. In an empty temp repo, install the tarball and run:
   - `cdd-kit init --local-only --provider both`
   - `cdd-kit doctor`
   - `cdd-kit doctor --json`
   - `cdd-kit context-scan`
   - `cdd-kit new smoke-change`
   - `cdd-kit migrate smoke-change --dry-run`
   - `cdd-kit context request smoke-change CER-001 --path specs/context/project-map.md --reason "smoke test"`
   - `cdd-kit context list smoke-change --json`
   - `cdd-kit upgrade`

## Upgrade Smoke Test

1. Create or reuse a fixture repo with pre-v1.11 `specs/changes/<id>/`.
2. Run `cdd-kit doctor --strict` and confirm it reports actionable warnings.
3. Run `cdd-kit upgrade --yes`.
4. Run `cdd-kit upgrade --yes --migrate-changes --enable-context-governance` in a disposable fixture and confirm the combined flow behaves as expected.
5. Run `cdd-kit migrate --all --dry-run`.
6. Run `cdd-kit migrate --all`.
7. For changes that should use Context Governance v1, run `cdd-kit migrate <id> --enable-context-governance`.
8. Run `cdd-kit context-scan`.
9. Run `cdd-kit gate <id>` and review context warnings before enabling strict mode.

## Publication

1. Bump the version with `npm version <x.y.z> --no-git-tag-version`.

   Never hand-edit the `version` field in `package.json`. The root version is
   recorded in three places -- `package.json`, `package-lock.json`'s top-level
   `version`, and its `packages[""].version` -- and only `npm version` writes
   all three. `--no-git-tag-version` skips the commit and tag so the bump still
   folds into the release commit, as this repo's history does.

   Releases 2.2.0 through 3.11.0 were bumped by hand, so the lockfile claimed
   `2.1.3` for ten releases. Nothing noticed: `npm ci` compares the dependency
   tree, not the root version; `npm publish` never ships the lockfile. If the
   two ever diverge again, `npm run check:lockfile` fails (it runs in CI and in
   `prepublishOnly`) and `npm install --package-lock-only` repairs it.

2. Confirm `package.json` version matches `CHANGELOG.md`.
3. Confirm README command docs match CLI help.
4. Commit all generated asset updates from `npm run -s build`.
5. Tag the release after tests and pack smoke pass.
