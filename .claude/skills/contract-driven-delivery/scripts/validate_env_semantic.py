#!/usr/bin/env python3
"""Semantic validation of the env contract variable table.

Reads contracts/env/env-contract.md (relative to cwd), skips YAML frontmatter,
finds the variable table (first markdown table whose header starts with '| name |'),
and validates each data row for:
  - secret=true AND non-empty default → fail (secrets must not have defaults)
  - required=true AND secret=false AND empty default → warn only (valid scenario)

Column order expected:
  name | scope | environments | required | secret | default | example | owner |
  validation | restart required | failure behavior
"""
import sys
import re
from pathlib import Path

CONTRACT_PATH = Path('contracts/env/env-contract.md')

# Column indices (0-based)
COL_NAME     = 0
COL_REQUIRED = 3
COL_SECRET   = 4
COL_DEFAULT  = 5


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter delimited by --- ... ---."""
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end != -1:
            return text[end + 4:].lstrip('\n')
    return text


def parse_table_row(line: str) -> list[str]:
    """Split a markdown table row into stripped cell values."""
    row = line.strip().strip('|')
    return [cell.strip() for cell in row.split('|')]


def is_separator_row(cells: list[str]) -> bool:
    """Return True if this is a markdown table separator (---|---|...)."""
    return all(re.match(r'^:?-+:?$', c) for c in cells if c)


def is_truthy(val: str) -> bool:
    """Return True if the value represents a truthy boolean in the table."""
    return val.lower() in {'true', 'yes', '1'}


def is_empty_default(val: str) -> bool:
    """Return True if the default column represents an absent/empty value."""
    return val in {'', '-', 'n/a', 'none', '—'}


def find_variable_table(lines: list[str]) -> list[tuple[int, str]]:
    """
    Find all rows belonging to any table with a '| name |' header in the document.
    This is robust to blank lines within the table and to the table header appearing
    multiple times (e.g., when content is appended to a file that already has a header).
    Returns list of (line_number, raw_line) for all data rows across all matching tables.
    """
    # Collect all (line_index, line) pairs that start with '|'
    # Track which lines are headers, separators, or data rows.
    in_name_table = False
    sep_seen = False
    data_rows: list[tuple[int, str]] = []

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Blank lines inside a table: keep scanning (don't break out of table mode)
        if not stripped:
            continue

        if not stripped.startswith('|'):
            # Non-pipe line: if we were collecting data, pause (but don't stop searching)
            # A new section heading might precede another occurrence of the table header.
            # We keep `in_name_table` True so we capture data rows even after headings.
            continue

        cells = parse_table_row(stripped)
        if not cells:
            continue

        # A header row for a '| name |' table
        if cells[0].lower() == 'name':
            in_name_table = True
            sep_seen = False
            continue  # skip header row itself

        if not in_name_table:
            continue

        # Separator row
        if not sep_seen and is_separator_row(cells):
            sep_seen = True
            continue

        # Data row
        data_rows.append((i + 1, line))

    return data_rows


def main() -> None:
    cwd = Path('.')
    contract = cwd / CONTRACT_PATH

    if not contract.exists():
        print(f'Env contract not found: {CONTRACT_PATH}')
        sys.exit(1)

    try:
        raw = contract.read_text(encoding='utf-8', errors='ignore')
    except OSError as e:
        print(f'Cannot read {CONTRACT_PATH}: {e}')
        sys.exit(1)

    if not raw.strip():
        print('Env contract: file is empty.')
        sys.exit(1)

    body = strip_frontmatter(raw)
    lines = body.splitlines()

    data_rows = find_variable_table(lines)

    if not data_rows:
        print('Env contract: no variable table found')
        sys.exit(1)

    errors: list[str] = []
    warnings: list[str] = []

    for lineno, raw_line in data_rows:
        cells = parse_table_row(raw_line)

        # Skip entirely empty rows
        if not any(cells):
            continue

        # Need at least name, required (col 3), secret (col 4), default (col 5)
        if len(cells) <= COL_DEFAULT:
            # Not enough columns to validate — skip silently
            continue

        name      = cells[COL_NAME]
        required  = is_truthy(cells[COL_REQUIRED])
        secret    = is_truthy(cells[COL_SECRET])
        default_  = cells[COL_DEFAULT]

        # Rule: secret=true AND non-empty default → fail
        if secret and not is_empty_default(default_):
            errors.append(
                f'Line {lineno}: variable "{name}" is secret=true but has '
                f'a non-empty default value "{default_}" '
                f'(secrets must not have defaults in the contract)'
            )

        # Rule: required=true AND secret=false AND empty default → warn only
        if required and not secret and is_empty_default(default_):
            warnings.append(
                f'Line {lineno}: variable "{name}" is required=true, '
                f'secret=false, and has no default — ensure it is always set.'
            )

    for w in warnings:
        print(f'Warning: {w}')

    if errors:
        print('Env semantic validation failed:')
        for err in errors:
            print(f'  {err}')
        sys.exit(1)

    print(f'Env semantic validation passed ({len(data_rows)} variable(s) checked).')


if __name__ == '__main__':
    main()
