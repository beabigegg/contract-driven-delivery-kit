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

1. Confirm `package.json` version matches `CHANGELOG.md`.
2. Confirm README command docs match CLI help.
3. Commit all generated asset updates from `npm run -s build`.
4. Tag the release after tests and pack smoke pass.
