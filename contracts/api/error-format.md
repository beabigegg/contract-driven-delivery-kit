# API Error Format

## Standard Error Shape

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "User-facing message",
    "details": "development-only or structured diagnostic data"
  }
}
```

Adapt the shape to each repo, but keep error code, user message, and safe diagnostic policy explicit.

## Error Codes
| code | status | user-facing message | retryable | owner |
|---|---:|---|---:|---|
