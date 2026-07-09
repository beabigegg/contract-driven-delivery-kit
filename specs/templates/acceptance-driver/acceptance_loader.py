"""Read-only loader for a change's acceptance oracle (ADR 0010 section 2).

Copy this file into your test tree (e.g. tests/acceptance/acceptance_loader.py)
next to your acceptance driver(s). It parses the change's acceptance.yml and
exposes id -> {input, expect} so the driver reads the answer key from the
artifact instead of hardcoding it -- the mechanical guarantee cdd-kit gate
checks for (AC-4; design.md Q2).

Usage in a driver:

    from acceptance_loader import load_case

    def test_over_limit_order_rejected():
        case = load_case("my-change", "over-limit-order-rejected")
        actual = real_system_under_test(case["input"])   # exercise the REAL SUT
        assert actual == case["expect"]                   # never hardcode this value

Never mock/patch the real system under test in an acceptance driver -- only
fake external I/O boundaries (network, clock) if needed. cdd-kit gate scans
drivers under tests/acceptance/ for both violations (AC-4).
"""
from pathlib import Path
import yaml


def resolve_acceptance_path(change_id: str) -> Path:
    """Locate a change's acceptance.yml.

    A change's acceptance.yml lives under specs/changes/<id>/ while the change is
    active, and moves to specs/archive/<year>/<id>/ when `cdd-kit archive` closes
    it. The driver must keep proving the oracle after the change is archived, so
    resolve both locations instead of hardcoding the active one.
    """
    active = Path("specs") / "changes" / change_id / "acceptance.yml"
    if active.exists():
        return active

    archive_root = Path("specs") / "archive"
    if archive_root.exists():
        for year in sorted(archive_root.iterdir()):
            archived = year / change_id / "acceptance.yml"
            if archived.exists():
                return archived

    raise FileNotFoundError(
        'no acceptance.yml for change "' + change_id + '" under specs/changes/ or specs/archive/*/'
    )


def load_all_cases(change_id: str) -> dict:
    """Return {case_id: {"input": ..., "expect": ...}} for the given change."""
    path = resolve_acceptance_path(change_id)
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cases = data.get("cases") or []
    return {c["id"]: {"input": c.get("input"), "expect": c.get("expect")} for c in cases}


def load_case(change_id: str, case_id: str) -> dict:
    """Return {"input": ..., "expect": ...} for one case."""
    cases = load_all_cases(change_id)
    if case_id not in cases:
        raise KeyError("no case '" + case_id + "' in " + str(resolve_acceptance_path(change_id)))
    return cases[case_id]
