# Changelog

## 0.2.0 - 2026-07-27

### Added

- Persistent Google Workspace MCP tool metadata caching with complete input and
  output schemas.
- Focused coverage for cache persistence, expiry, corruption, partial service
  failures, write failures, and service-level invalidation.
- Update and uninstall instructions for Claude, Codex, and standalone MCP
  clients.

### Changed

- Workspace calls no longer fetch a service's tool catalog before every tool
  invocation.
- Authentication guidance now directs clients to call the requested Workspace
  tool first and authenticate only after an authentication-required response.
- Tool metadata is reused across plugin processes for up to 24 hours, with
  stale metadata available when catalog refresh temporarily fails.

## 0.1.0 - 2026-07-27

- Initial release.
