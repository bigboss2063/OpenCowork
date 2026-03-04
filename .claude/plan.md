# Plan

1. Add a shared OAuth token normalization/apply helper that can parse manual JSON (access/refresh tokens, optional expiry) and update provider state.
2. Extend the Provider settings UI (Codex OAuth) with a manual JSON input, validation, and apply flow that calls the helper and shows errors/toasts.
3. Add i18n strings (EN/ZH) for the new manual-token UI and validation messages.
