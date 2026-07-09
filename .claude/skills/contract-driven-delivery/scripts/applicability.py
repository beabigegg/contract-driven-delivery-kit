#!/usr/bin/env python3
"""Shared `applicability` frontmatter-marker reader (ADR 0011).

Single pass/fail authority for the `applicability: not-applicable` contract
marker. Every semantic/presence validator that enforces a per-family contract
check (`validate_contracts.py`, `validate_api_semantic.py`, defensively
`validate_api_conformance.py` / `validate_response_shape.py` /
`validate_env_semantic.py`) imports `classify_file` from this module and
self-skips or hard-errors from its result — never re-implementing the rule.
See contracts/ci/ci-gate-contract.md Section "Contract Applicability Marker
(ADR 0011)" for the exact grammar this mirrors.

`src/contracts/parser.ts`'s `projectApplicability` reads the identical
frontmatter fields for DISPLAY only (`cdd-kit doctor`); it carries no
skip/fail authority — this module is the sole one (design.md decision 2).

Fail-closed semantics:
  1. No `applicability` field, or `applicability: applicable`  -> 'applicable'
     (validated exactly as today; AC-2).
  2. `applicability: not-applicable` + non-empty `applicability-reason`
     -> 'not-applicable' (skip the family check; AC-1).
  3. `applicability: not-applicable` with a missing/empty
     `applicability-reason` -> 'invalid' (hard error; AC-3).
  4. Any unrecognized `applicability` value (e.g. a typo) -> 'invalid'
     (hard error; never applicable-by-default or not-applicable-by-default).
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union
import re

ALLOWED_VALUES = {'applicable', 'not-applicable'}

# Mirrors parser.ts's stripFrontmatter field regex (`^([A-Za-z0-9_-]+):\s*(.*)$`)
# so TS and Python read the identical frontmatter grammar (AC-6).
_FIELD_RE = re.compile(r'^([A-Za-z0-9_-]+):\s*(.*)$')


def parse_frontmatter(text: str) -> dict:
    """Parse the `key: value` lines out of a --- ... --- frontmatter block.
    Returns {} when there is no (well-formed) frontmatter block."""
    fm: dict = {}
    if not text.startswith('---'):
        return fm
    end = text.find('\n---', 3)
    if end == -1:
        return fm
    block = text[3:end]
    for line in block.split('\n'):
        m = _FIELD_RE.match(line)
        if m:
            fm[m.group(1).strip()] = m.group(2).strip()
    return fm


def _unquote(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        return v[1:-1].strip()
    return v


@dataclass
class Applicability:
    """Classification result. `status` is one of 'applicable' /
    'not-applicable' / 'invalid'. `reason` is set only for 'not-applicable'.
    `error` is set only for 'invalid' (a human-readable, fail-closed message)."""
    status: str
    reason: Optional[str] = None
    error: Optional[str] = None


def classify(frontmatter: dict) -> Applicability:
    """Classify a parsed frontmatter dict per the fail-closed rules above."""
    raw = frontmatter.get('applicability')
    if raw is None or raw.strip() == '':
        return Applicability(status='applicable')

    value = _unquote(raw)

    if value == 'applicable':
        return Applicability(status='applicable')

    if value == 'not-applicable':
        raw_reason = frontmatter.get('applicability-reason')
        reason = _unquote(raw_reason) if raw_reason is not None else ''
        if not reason:
            return Applicability(status='invalid', error=(
                'applicability: not-applicable requires a non-empty '
                'applicability-reason (ADR 0011) — a bare skip with no '
                'justification is never allowed.'
            ))
        return Applicability(status='not-applicable', reason=reason)

    return Applicability(status='invalid', error=(
        f'unrecognized applicability value "{raw.strip()}" — expected '
        f'"applicable" or "not-applicable" (ADR 0011).'
    ))


def classify_file(path: Union[str, Path]) -> Applicability:
    """Read `path` and classify its frontmatter's applicability marker. A
    missing/unreadable file classifies as 'applicable' — file existence is
    each validator's own concern, not this reader's."""
    p = Path(path)
    try:
        text = p.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return Applicability(status='applicable')
    return classify(parse_frontmatter(text))


if __name__ == '__main__':
    import sys
    import json

    if len(sys.argv) != 2:
        print('usage: applicability.py <contract-path>', file=sys.stderr)
        sys.exit(2)

    result = classify_file(sys.argv[1])
    print(json.dumps({'status': result.status, 'reason': result.reason, 'error': result.error}))
