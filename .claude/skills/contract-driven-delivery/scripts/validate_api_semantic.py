#!/usr/bin/env python3
"""Semantic validation of the API contract endpoint table.

Reads contracts/api/api-contract.md (relative to cwd), skips YAML frontmatter,
finds the endpoint table (first markdown table whose header starts with '| method |'),
and validates each data row for:
  - method ∈ VALID_METHODS
  - path starts with '/'
  - auth ∈ VALID_AUTH
  - at least 5 columns present
"""
import sys
import re
from pathlib import Path

VALID_METHODS = {'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'}
VALID_AUTH = {'required', 'optional', 'admin', 'none', 'public'}

CONTRACT_PATH = Path('contracts/api/api-contract.md')


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter delimited by --- ... ---."""
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            return text[end + 4:].lstrip('\n')
    return text


def parse_table_row(line: str) -> list[str]:
    """Split a markdown table row into stripped cell values."""
    # Remove leading/trailing pipes and whitespace, then split on '|'
    row = line.strip().strip('|')
    return [cell.strip() for cell in row.split('|')]


def is_separator_row(cells: list[str]) -> bool:
    """Return True if this is a markdown table separator (---|---|...)."""
    return all(re.match(r'^:?-+:?$', c) for c in cells if c)


def find_endpoint_table(lines: list[str]) -> list[tuple[int, str]]:
    """
    Find all data rows across ALL '| method |' tables in the document.
    Blank lines and prose between rows do not end collection, making this
    robust to files where content is appended after the original table block.
    """
    in_table = False
    sep_seen = False
    data_rows: list[tuple[int, str]] = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        if not stripped:
            continue  # blank lines never end table mode

        if not stripped.startswith('|'):
            # Non-pipe line: keep searching (don't break)
            # A new `## heading` may precede a duplicate table header
            continue

        cells = parse_table_row(stripped)
        if not cells:
            continue

        # A header row for an endpoint table
        if cells[0].lower() == 'method':
            in_table = True
            sep_seen = False
            continue  # skip header row

        if not in_table:
            continue

        # Separator row
        if not sep_seen and is_separator_row(cells):
            sep_seen = True
            continue

        # Data row
        data_rows.append((i + 1, line))  # 1-based line numbers

    return data_rows


def main() -> None:
    cwd = Path('.')
    contract = cwd / CONTRACT_PATH

    if not contract.exists():
        print(f'API contract not found: {CONTRACT_PATH}')
        sys.exit(1)

    try:
        raw = contract.read_text(encoding='utf-8', errors='ignore')
    except OSError as e:
        print(f'Cannot read {CONTRACT_PATH}: {e}')
        sys.exit(1)

    if not raw.strip():
        print('API contract: file is empty.')
        sys.exit(1)

    body = strip_frontmatter(raw)
    lines = body.splitlines()

    data_rows = find_endpoint_table(lines)

    if not data_rows:
        print('API contract: no endpoint table found')
        sys.exit(1)

    errors: list[str] = []

    for lineno, raw_line in data_rows:
        cells = parse_table_row(raw_line)

        # Skip entirely empty rows (blank table filler lines)
        if not any(cells):
            continue

        # Must have at least 5 columns: method, path, auth, request, response
        if len(cells) < 5:
            errors.append(
                f'Line {lineno}: row has only {len(cells)} column(s), need at least 5: {raw_line.strip()}'
            )
            continue

        method = cells[0].upper()
        path   = cells[1]
        auth   = cells[2].lower()

        if method not in VALID_METHODS:
            errors.append(
                f'Line {lineno}: invalid method "{cells[0]}" '
                f'(valid: {", ".join(sorted(VALID_METHODS))})'
            )

        if not path.startswith('/'):
            errors.append(
                f'Line {lineno}: path "{path}" does not start with "/"'
            )

        if auth not in VALID_AUTH:
            errors.append(
                f'Line {lineno}: invalid auth "{cells[2]}" '
                f'(valid: {", ".join(sorted(VALID_AUTH))})'
            )

    if errors:
        print('API semantic validation failed:')
        for err in errors:
            print(f'  {err}')
        sys.exit(1)

    print(f'API semantic validation passed ({len(data_rows)} endpoint(s) checked).')


if __name__ == '__main__':
    main()
