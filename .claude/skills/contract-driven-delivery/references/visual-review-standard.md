# Visual Review Standard

Visual review is required when frontend output changes.

## Required dimensions

- affected pages/screens
- changed components
- desktop, tablet, and mobile viewports
- default, loading, empty, error, disabled, focus, hover, long text, no permission states
- modal, drawer, dropdown, tooltip overflow behavior
- table overflow and column width behavior
- dark mode or theme behavior when applicable
- accessibility: focus, keyboard, labels, contrast

## Evidence levels

| level | evidence |
|---|---|
| basic | manual checklist with viewports and states |
| standard | screenshots before/after or after-only for new UI |
| strong | visual regression diff with accepted changes |
| high-risk | video/trace plus visual diff and UX review |

## Review output

Use `templates/visual-review-report.md`.
