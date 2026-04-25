# CSS/UI Contract Standard

## Principles

- Tokens are the source of visual truth.
- Shared components define allowed variants and states.
- One-off visual hacks must be justified or avoided.
- UI changes require visual evidence.

## Required definitions

- token source of truth
- component variants
- component sizes
- component states: default, hover, focus, active, disabled, loading, error, empty
- responsive behavior
- accessibility requirements
- allowed overrides
- forbidden overrides

## Forbidden by default

- hard-coded colors when token system exists
- arbitrary spacing when scale exists
- global style leakage
- overriding shared component internals from feature CSS
- unreviewed z-index additions
- UI states without loading/error/empty handling
- browser dialogs when design system dialog/toast exists

## Visual review requirements

For UI output changes, check:

- desktop, tablet, mobile viewports
- long text and empty data
- loading and error states
- keyboard focus and tab order
- modal/dropdown/tooltip overflow
- visual diff or screenshot evidence
