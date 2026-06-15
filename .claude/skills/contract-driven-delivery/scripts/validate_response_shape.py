#!/usr/bin/env python3
"""Data-shape conformance: validate real response bodies against the contract.

ADR 0007. The route-level conformance validator (validate_api_conformance.py)
only checks method+path. This one closes the body-level gap that actually breaks
frontend/backend integration: it asserts that a captured response *sample*
matches the response *schema* the contract declares for that endpoint.

It is stack-agnostic by construction — it reads only JSON (the generated
``contracts/api/openapi.json`` projection) and JSON Schema, never source code, so
it works the same for Flask, FastAPI, Express, or Go. The only language-neutral
place a response shape is observable is the serialized JSON at the HTTP boundary;
a sample captures exactly that.

Opt-in by adoption, enforced by default once adopted:
  - No sample manifest (tests/contract/response-samples.json) -> skip, exit 0.
    Existing projects are untouched on ``npm update``.
  - Manifest present -> a declared-schema mismatch is an ERROR by default (not a
    warning behind a flag — a protection that defaults to advisory gets disarmed).
  - An endpoint whose contract response cell is still prose (no resolved schema
    in openapi.json) is simply not checked — incremental adoption, never forced.

Manifest (tests/contract/response-samples.json):
{
  "POST /api/hold-overview/summary": {
    "sample": "samples/hold_overview_summary.json",
    "dataPath": "data"          // optional: drill into an envelope before validating
  },
  "GET /health": "samples/health.json"   // shorthand: string == {"sample": "..."}
}

Config (.cdd/conformance.json, optional "responseShape" block):
  { "responseShape": { "enabled": true, "severity": "error",
                       "manifest": "tests/contract/response-samples.json" } }
Defaults when a manifest exists: enabled=true, severity=error.

Exit codes:
  0  all sampled endpoints conform, or skipped (no manifest / no openapi.json)
  1  a sample violates its contract schema (or severity escalated / setup error)
"""
import json
import re
import sys
from pathlib import Path

OPENAPI_PATH = Path('contracts/api/openapi.json')
CONFIG_PATH = Path('.cdd/conformance.json')
DEFAULT_MANIFEST = 'tests/contract/response-samples.json'

VALID_METHODS = {'get', 'post', 'put', 'delete', 'patch', 'head', 'options'}


# ── config ──────────────────────────────────────────────────────────────────

def load_response_shape_config() -> dict:
    cfg = {'enabled': True, 'severity': 'error', 'manifest': DEFAULT_MANIFEST}
    if not CONFIG_PATH.exists():
        return cfg
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return cfg  # a malformed conformance.json is validate_api_conformance.py's concern
    block = raw.get('responseShape')
    if isinstance(block, dict):
        if isinstance(block.get('enabled'), bool):
            cfg['enabled'] = block['enabled']
        if block.get('severity') in ('error', 'warning'):
            cfg['severity'] = block['severity']
        if isinstance(block.get('manifest'), str) and block['manifest'].strip():
            cfg['manifest'] = block['manifest'].strip()
    return cfg


# ── path / endpoint keying ───────────────────────────────────────────────────

def normalize_path(path: str) -> str:
    """Collapse `:id` and `{ id }` param forms so a manifest key and an
    openapi path template compare equal; drop any query/hash suffix."""
    path = path.split('?', 1)[0].split('#', 1)[0]
    # `:name` and `{name}` param forms both collapse to `{}`
    path = re.sub(r':([A-Za-z_]\w*)', '{}', path)
    path = re.sub(r'\{[^}/]*\}', '{}', path)
    if not path.startswith('/'):
        path = '/' + path
    if len(path) > 1:
        path = path.rstrip('/')
    return re.sub(r'/{2,}', '/', path)


def parse_endpoint_key(key: str):
    """'POST /api/x' -> ('post', '/api/x' normalized), or None if malformed."""
    parts = key.strip().split(None, 1)
    if len(parts) != 2:
        return None
    method, path = parts[0].lower(), parts[1].strip()
    if method not in VALID_METHODS or not path.startswith('/'):
        return None
    return method, normalize_path(path)


# ── openapi response-schema extraction ───────────────────────────────────────

def success_response_schema(operation: dict):
    """Return the JSON schema object for the first 2xx response that carries an
    application/json schema, or None when the contract left the body unresolved."""
    responses = operation.get('responses')
    if not isinstance(responses, dict):
        return None
    for code in sorted(responses):
        if not (isinstance(code, str) and code.startswith('2')):
            continue
        content = responses[code].get('content') if isinstance(responses[code], dict) else None
        if not isinstance(content, dict):
            continue
        media = content.get('application/json')
        if isinstance(media, dict) and isinstance(media.get('schema'), dict):
            return media['schema']
    return None


def build_endpoint_schema_map(openapi: dict):
    """Map (method, normalized_path) -> response schema object, for every
    endpoint whose contract response body resolved to a schema."""
    out = {}
    paths = openapi.get('paths')
    if not isinstance(paths, dict):
        return out
    for raw_path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        np = normalize_path(raw_path)
        for method, operation in methods.items():
            if method.lower() not in VALID_METHODS or not isinstance(operation, dict):
                continue
            schema = success_response_schema(operation)
            if schema is not None:
                out[(method.lower(), np)] = schema
    return out


# ── sample loading + validation ──────────────────────────────────────────────

def drill(value, data_path: str):
    """Follow a dotted dataPath (e.g. 'data' or 'result.items') into a sample.
    Returns (ok, value_or_errormsg)."""
    cur = value
    for part in [p for p in data_path.split('.') if p]:
        if not isinstance(cur, dict) or part not in cur:
            return False, f"dataPath '{data_path}' not found (no key '{part}')"
        cur = cur[part]
    return True, cur


def validate_one(validator_cls, instance, response_schema, components):
    """Validate `instance` against `response_schema`, resolving any
    #/components/schemas/* refs against the openapi components. Returns a list of
    human-readable error strings (empty == valid)."""
    # The response schema may be a $ref or inline; either way, give the validator
    # a document root that carries `components` so internal refs resolve.
    schema_doc = dict(response_schema)
    schema_doc.setdefault('components', components)
    validator = validator_cls(schema_doc)
    errors = []
    for err in sorted(validator.iter_errors(instance), key=lambda e: list(e.path)):
        loc = '/'.join(str(p) for p in err.path) or '(root)'
        errors.append(f"at {loc}: {err.message}")
    return errors


def main() -> None:
    cfg = load_response_shape_config()
    manifest_path = Path(cfg['manifest'])

    # Opt-in by adoption: no manifest means this project has not adopted response
    # sampling. Skip silently (exit 0) so `npm update` never breaks a project that
    # never asked for this check.
    if not manifest_path.exists():
        print(f'Response-shape: skipped (no {cfg["manifest"]}; '
              f'add it to assert response bodies against the contract). See ADR 0007.')
        sys.exit(0)

    if not cfg['enabled']:
        print('Response-shape: skipped (.cdd/conformance.json responseShape.enabled is false).')
        sys.exit(0)

    if not OPENAPI_PATH.exists():
        print(f'Response-shape validation failed:')
        print(f'  {cfg["manifest"]} exists but {OPENAPI_PATH} does not. '
              f'Run `cdd-kit openapi export --out {OPENAPI_PATH}` and commit it.')
        sys.exit(1)

    try:
        openapi = json.loads(OPENAPI_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print('Response-shape validation failed:')
        print(f'  cannot read {OPENAPI_PATH}: {e}')
        sys.exit(1)

    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        print('Response-shape validation failed:')
        print(f'  cannot read {cfg["manifest"]}: {e}')
        sys.exit(1)
    if not isinstance(manifest, dict) or not manifest:
        print(f'Response-shape: {cfg["manifest"]} has no entries; nothing to check.')
        sys.exit(0)

    # jsonschema is only required once a manifest exists (i.e. the project opted
    # in). Fail loudly with an install hint rather than silently skipping.
    try:
        import jsonschema
        from jsonschema import Draft202012Validator as ValidatorCls
    except ImportError:
        print('Response-shape validation failed:')
        print(f'  {cfg["manifest"]} exists but the `jsonschema` package is not installed.')
        print('  Install it (e.g. `pip install jsonschema` or `conda install jsonschema`) to enforce response shapes.')
        sys.exit(1)

    components = openapi.get('components', {}) if isinstance(openapi.get('components'), dict) else {}
    endpoint_schemas = build_endpoint_schema_map(openapi)
    manifest_dir = manifest_path.parent

    errors = []
    warnings = []
    checked = 0

    for key, entry in manifest.items():
        parsed = parse_endpoint_key(key)
        if parsed is None:
            warnings.append(f'manifest key "{key}" is not a valid "METHOD /path" — skipped')
            continue
        if isinstance(entry, str):
            entry = {'sample': entry}
        if not isinstance(entry, dict) or not isinstance(entry.get('sample'), str):
            warnings.append(f'{key}: entry must be a sample path string or an object with a "sample" key — skipped')
            continue

        schema = endpoint_schemas.get(parsed)
        if schema is None:
            warnings.append(
                f'{key}: no resolved response schema in {OPENAPI_PATH} '
                f'(the contract response cell is still prose, or the endpoint is absent). '
                f'Declare a typed `## Schemas` entry and reference it to enforce this endpoint.')
            continue

        sample_path = (manifest_dir / entry['sample']).resolve()
        if not sample_path.exists():
            errors.append(f'{key}: sample file not found: {entry["sample"]}')
            continue
        try:
            instance = json.loads(sample_path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as e:
            errors.append(f'{key}: cannot read sample {entry["sample"]}: {e}')
            continue

        data_path = entry.get('dataPath')
        if isinstance(data_path, str) and data_path.strip():
            ok, drilled = drill(instance, data_path.strip())
            if not ok:
                errors.append(f'{key}: {drilled} in sample {entry["sample"]}')
                continue
            instance = drilled

        violations = validate_one(ValidatorCls, instance, schema, components)
        checked += 1
        if violations:
            head = f'{key}: response sample does not match the contract schema:'
            errors.append(head + '\n      ' + '\n      '.join(violations))

    severity = cfg['severity']
    print(f'Response-shape: checked {checked} sampled endpoint(s) against {OPENAPI_PATH}.')

    if warnings:
        print('Response-shape warnings:')
        for w in warnings:
            print(f'  {w}')

    if errors:
        # severity=warning downgrades violations to non-blocking (a ratchet), but
        # the default with a manifest present is error — see ADR 0007.
        if severity == 'warning':
            print('Response-shape warnings (severity=warning, not blocking):')
            for e in errors:
                print(f'  {e}')
            sys.exit(0)
        print('Response-shape validation failed:')
        for e in errors:
            print(f'  {e}')
        sys.exit(1)

    print('Response-shape validation passed.')


if __name__ == '__main__':
    main()
