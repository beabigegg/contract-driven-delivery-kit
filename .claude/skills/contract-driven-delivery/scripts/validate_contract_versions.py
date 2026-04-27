#!/usr/bin/env python3
"""
validate_contract_versions.py — Contract Version Control Validator (v1.2.0)

For every contract file, validates:
  - frontmatter presence and schema correctness (always)
  - content-change ↔ version-bump coherence (1.0+ only)
  - no version skips or downgrades (1.0+ only)
  - CHANGELOG.md entry exists for every bump (1.0+ only)
  - major bump CHANGELOG entry includes ### Removed or ### Changed (breaking)
"""

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

# ── Constants ─────────────────────────────────────────────────────────────────

CONTRACT_FILES = [
    'contracts/api/api-contract.md',
    'contracts/css/css-contract.md',
    'contracts/env/env-contract.md',
    'contracts/data/data-shape-contract.md',
    'contracts/business/business-rules.md',
    'contracts/ci/ci-gate-contract.md',
]

VALID_CONTRACT_TYPES = {'api', 'css', 'env', 'data', 'business', 'ci'}
VALID_BREAKING_POLICIES = {'deprecate-2-minors', 'fail-on-major', 'no-breaking'}
SEMVER_RE = re.compile(r'^\d+\.\d+\.\d+$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

CHANGELOG_PATH = 'contracts/CHANGELOG.md'

# ── Frontmatter Parser (zero-dependency) ──────────────────────────────────────

def parse_frontmatter(text: str):
    """
    Parse YAML-style frontmatter from a markdown file.
    Returns (fields_dict, body_text) or (None, text) if no frontmatter.
    Handles the pattern: ^---\n...\n---\n
    """
    if not text.startswith('---\n'):
        return None, text

    end = text.find('\n---\n', 4)
    if end == -1:
        return None, text

    fm_block = text[4:end]
    body = text[end + 5:]  # skip '\n---\n'

    fields = {}
    for line in fm_block.splitlines():
        if ':' in line:
            key, _, value = line.partition(':')
            fields[key.strip()] = value.strip()

    return fields, body


def strip_frontmatter(text: str) -> str:
    """Return the body text with frontmatter removed."""
    _, body = parse_frontmatter(text)
    return body


def sha256_of(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


# ── Semver helpers ────────────────────────────────────────────────────────────

def parse_semver(s: str):
    """Return (major, minor, patch) tuple or None."""
    m = SEMVER_RE.match(s)
    if not m:
        return None
    parts = s.split('.')
    return int(parts[0]), int(parts[1]), int(parts[2])


def is_pre_1_0(ver_tuple) -> bool:
    return ver_tuple[0] == 0


# ── CHANGELOG parser ──────────────────────────────────────────────────────────

def parse_changelog(root: Path):
    """
    Parse contracts/CHANGELOG.md and return a dict:
      { (contract_type, version_str): set_of_section_types }
    section types are the ### headings: 'Added', 'Changed (non-breaking)', etc.
    """
    cl_path = root / CHANGELOG_PATH
    if not cl_path.exists():
        return {}

    text = cl_path.read_text(encoding='utf-8', errors='ignore')
    entries = {}

    # Match headings like: ## [api 1.0.0] — 2026-01-10
    heading_re = re.compile(
        r'^## \[([a-z]+) (\d+\.\d+\.\d+)\]',
        re.MULTILINE
    )
    section_re = re.compile(r'^### (.+)$', re.MULTILINE)

    matches = list(heading_re.finditer(text))
    for i, m in enumerate(matches):
        contract_type = m.group(1)
        version = m.group(2)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end]

        sections = set(s.strip() for s in section_re.findall(block))
        entries[(contract_type, version)] = sections

    return entries


# ── Git helpers ───────────────────────────────────────────────────────────────

def git_available(root: Path) -> bool:
    """Return True if git is available and root is inside a git repo."""
    try:
        r = subprocess.run(
            ['git', 'rev-parse', '--git-dir'],
            capture_output=True,
            text=True,
            cwd=str(root),
        )
        return r.returncode == 0
    except FileNotFoundError:
        return False


def git_show_head(root: Path, rel_path: str) -> str | None:
    """
    Return file content at HEAD, or None if:
    - git unavailable
    - file not tracked / no HEAD yet
    """
    try:
        r = subprocess.run(
            ['git', 'show', f'HEAD:{rel_path}'],
            capture_output=True,
            text=True,
            cwd=str(root),
        )
        if r.returncode == 0:
            return r.stdout
        return None
    except FileNotFoundError:
        return None


# ── Per-file validation ───────────────────────────────────────────────────────

def validate_format(rel_path: str, fields, errors: list) -> bool:
    """
    Validate frontmatter fields. Returns True if all required fields pass.
    Appends error messages to `errors`.
    """
    ok = True

    if fields is None:
        errors.append(f'{rel_path}: missing frontmatter (expected ---...--- block)')
        return False

    # contract type
    contract = fields.get('contract', '')
    if not contract:
        errors.append(f'{rel_path}: frontmatter missing field "contract"')
        ok = False
    elif contract not in VALID_CONTRACT_TYPES:
        errors.append(
            f'{rel_path}: invalid contract type "{contract}" '
            f'(allowed: {", ".join(sorted(VALID_CONTRACT_TYPES))})'
        )
        ok = False

    # schema-version
    schema_version = fields.get('schema-version', '')
    if not schema_version:
        errors.append(f'{rel_path}: frontmatter missing field "schema-version"')
        ok = False
    elif not SEMVER_RE.match(schema_version):
        errors.append(
            f'{rel_path}: invalid schema-version "{schema_version}" '
            f'(must match X.Y.Z)'
        )
        ok = False

    # last-changed
    last_changed = fields.get('last-changed', '')
    if not last_changed:
        errors.append(f'{rel_path}: frontmatter missing field "last-changed"')
        ok = False
    elif not DATE_RE.match(last_changed):
        errors.append(
            f'{rel_path}: invalid last-changed "{last_changed}" '
            f'(must be YYYY-MM-DD)'
        )
        ok = False

    # breaking-change-policy
    policy = fields.get('breaking-change-policy', '')
    if not policy:
        errors.append(f'{rel_path}: frontmatter missing field "breaking-change-policy"')
        ok = False
    elif policy not in VALID_BREAKING_POLICIES:
        errors.append(
            f'{rel_path}: invalid breaking-change-policy "{policy}" '
            f'(allowed: {", ".join(sorted(VALID_BREAKING_POLICIES))})'
        )
        ok = False

    return ok


def validate_file(root: Path, rel_path: str, changelog_entries: dict, errors: list):
    abs_path = root / rel_path

    if not abs_path.exists():
        errors.append(f'{rel_path}: file not found')
        return

    current_text = abs_path.read_text(encoding='utf-8', errors='ignore')
    current_fields, current_body = parse_frontmatter(current_text)

    # ── Always validate format ────────────────────────────────────────────────
    format_ok = validate_format(rel_path, current_fields, errors)
    if not format_ok:
        return  # cannot proceed without valid frontmatter

    schema_version_str = current_fields.get('schema-version', '')
    current_ver = parse_semver(schema_version_str)
    if current_ver is None:
        return  # already caught above

    contract_type = current_fields.get('contract', '')

    # ── Try to get HEAD version ───────────────────────────────────────────────
    head_text = git_show_head(root, rel_path)

    if head_text is None:
        # New/untracked file or no HEAD — baseline, format already validated
        return

    head_fields, head_body = parse_frontmatter(head_text)

    if head_fields is None:
        # HEAD had no frontmatter — treat as baseline (format already validated)
        return

    head_version_str = head_fields.get('schema-version', '')
    head_ver = parse_semver(head_version_str)
    if head_ver is None:
        # HEAD had invalid version — can't compare sensibly, skip extra rules
        return

    # ── Pre-1.0: only format validation ──────────────────────────────────────
    if is_pre_1_0(current_ver):
        return

    # ── Post-1.0 rules ────────────────────────────────────────────────────────

    current_body_hash = sha256_of(current_body)
    head_body_hash = sha256_of(head_body)
    content_changed = current_body_hash != head_body_hash
    version_changed = current_ver != head_ver

    # a) Content ↔ version coherence
    if content_changed and not version_changed:
        errors.append(
            f'{rel_path}: content changed but schema-version not bumped '
            f'(still {schema_version_str})'
        )
        return

    if version_changed and not content_changed:
        errors.append(
            f'{rel_path}: version changed without content change '
            f'({head_version_str} → {schema_version_str})'
        )
        return

    if not version_changed:
        # No change at all — fine
        return

    # b) Version bump rules (version_changed == True here)
    new_maj, new_min, new_pat = current_ver
    old_maj, old_min, old_pat = head_ver

    # No downgrade
    if current_ver < head_ver:
        errors.append(
            f'{rel_path}: schema-version downgrade not allowed '
            f'({head_version_str} → {schema_version_str})'
        )
        return

    # Major bump: must be exactly +1, minor and patch reset to 0
    if new_maj > old_maj:
        if new_maj != old_maj + 1:
            errors.append(
                f'{rel_path}: major version skip not allowed '
                f'({head_version_str} → {schema_version_str}); '
                f'must increment by 1'
            )
            return
        # major bump is valid version increment; fall through to CHANGELOG check

    # Minor bump (same major): must be exactly +1, patch reset to 0
    elif new_min > old_min:
        if new_min != old_min + 1:
            errors.append(
                f'{rel_path}: minor version skip not allowed '
                f'({head_version_str} → {schema_version_str}); '
                f'must increment by 1'
            )
            return

    # Patch bump (same major.minor): any positive increment is ok

    # c) CHANGELOG entry required
    key = (contract_type, schema_version_str)
    if key not in changelog_entries:
        errors.append(
            f'{rel_path}: schema-version bumped to {schema_version_str} '
            f'but no CHANGELOG entry "## [{contract_type} {schema_version_str}]" found'
        )
        return

    # d) Major bump requires ### Removed or ### Changed (breaking)
    if new_maj > old_maj:
        sections = changelog_entries[key]
        if 'Removed' not in sections and 'Changed (breaking)' not in sections:
            errors.append(
                f'{rel_path}: major version bump to {schema_version_str} '
                f'requires "### Removed" or "### Changed (breaking)" '
                f'in CHANGELOG entry (found sections: {sections or "none"})'
            )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description='Validate contract file versions against frontmatter and CHANGELOG.'
    )
    ap.add_argument('root', nargs='?', default='.', help='Project root directory')
    args = ap.parse_args()
    root = Path(args.root).resolve()

    if not git_available(root):
        print(
            'Warning: git not available or not a git repo — '
            'skipping version comparison checks, validating format only.'
        )

    changelog_entries = parse_changelog(root)
    errors: list[str] = []

    for rel_path in CONTRACT_FILES:
        validate_file(root, rel_path, changelog_entries, errors)

    if errors:
        print('Contract version validation FAILED:')
        for e in errors:
            print(f'  FAIL: {e}')
        sys.exit(1)
    else:
        print('Contract version validation passed.')
        sys.exit(0)


if __name__ == '__main__':
    main()
