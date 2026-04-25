# Data Shape Contract Standard

Use this standard for reports, dashboards, exports, imports, tables, charts, and any feature that transforms tabular or semi-structured data.

## Required definitions

- required columns
- optional columns
- column types
- nullability
- allowed values
- timezone and date format
- numeric precision and rounding
- row limits
- pagination or truncation behavior
- empty dataset behavior
- malformed data behavior
- export format and encoding
- backward compatibility rules

## Invalid data behavior

| condition | required decision |
|---|---|
| missing required column | reject or default with warning |
| wrong type | reject, coerce, or mark invalid |
| duplicate key | deterministic merge or explicit error |
| empty dataset | safe empty state, not 500 |
| over row limit | truncate with metadata or reject |
| unexpected enum | display fallback or reject |
| malformed date | validation error with user-friendly message |

## Required tests

- valid representative dataset
- empty dataset
- large dataset
- missing column
- wrong type
- null values
- unexpected enum
- malicious strings
- export boundary if export exists
