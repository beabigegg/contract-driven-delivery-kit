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


def _acceptance_yml_path(change_id: str) -> Path:
    return Path("specs") / "changes" / change_id / "acceptance.yml"


def load_all_cases(change_id: str) -> dict:
    """Return {case_id: {"input": ..., "expect": ...}} for the given change."""
    path = _acceptance_yml_path(change_id)
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cases = data.get("cases") or []
    return {c["id"]: {"input": c.get("input"), "expect": c.get("expect")} for c in cases}


def load_case(change_id: str, case_id: str) -> dict:
    """Return {"input": ..., "expect": ...} for one case."""
    cases = load_all_cases(change_id)
    if case_id not in cases:
        raise KeyError("no case '" + case_id + "' in specs/changes/" + change_id + "/acceptance.yml")
    return cases[case_id]
