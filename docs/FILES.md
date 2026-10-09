# Danh sách file mới

Audit ban đầu không có file nào. Danh sách dưới đây chỉ gồm source, config, test và tài liệu; không bao gồm node_modules, npm cache, data/ hay dist/.

- [.env.example](../.env.example)
- [.gitignore](../.gitignore)
- [README.md](../README.md)
- [deploy/Dockerfile](../deploy/Dockerfile)
- [deploy/README.md](../deploy/README.md)
- [deploy/nginx.conf.example](../deploy/nginx.conf.example)
- [docs/ADAPTERS.md](../docs/ADAPTERS.md)
- [docs/FILES.md](../docs/FILES.md)
- [docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md)
- [docs/SECURITY.md](../docs/SECURITY.md)
- [extension/README.md](../extension/README.md)
- [extension/adapters/base.mjs](../extension/adapters/base.mjs)
- [extension/adapters/registry.mjs](../extension/adapters/registry.mjs)
- [extension/adapters/tphcm.mjs](../extension/adapters/tphcm.mjs)
- [extension/api/sync.mjs](../extension/api/sync.mjs)
- [extension/background/service-worker.mjs](../extension/background/service-worker.mjs)
- [extension/build.mjs](../extension/build.mjs)
- [extension/content/collector.js](../extension/content/collector.js)
- [extension/content/collector.mjs](../extension/content/collector.mjs)
- [extension/manifest.json](../extension/manifest.json)
- [extension/options/index.html](../extension/options/index.html)
- [extension/options/options.mjs](../extension/options/options.mjs)
- [extension/popup/index.html](../extension/popup/index.html)
- [extension/popup/popup.mjs](../extension/popup/popup.mjs)
- [extension/shared/normalize.mjs](../extension/shared/normalize.mjs)
- [extension/shared/registry.mjs](../extension/shared/registry.mjs)
- [extension/ui.css](../extension/ui.css)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [scripts/benchmark.mjs](../scripts/benchmark.mjs)
- [scripts/browser-smoke.mjs](../scripts/browser-smoke.mjs)
- [scripts/build.mjs](../scripts/build.mjs)
- [scripts/check.mjs](../scripts/check.mjs)
- [server/app.mjs](../server/app.mjs)
- [server/auth.mjs](../server/auth.mjs)
- [server/cases.mjs](../server/cases.mjs)
- [server/cli.mjs](../server/cli.mjs)
- [server/database.mjs](../server/database.mjs)
- [server/engine.ts](../server/engine.ts)
- [server/import.mjs](../server/import.mjs)
- [server/main.mjs](../server/main.mjs)
- [server/migrations/001_initial.sql](../server/migrations/001_initial.sql)
- [server/notifications.mjs](../server/notifications.mjs)
- [server/seed.mjs](../server/seed.mjs)
- [shared/domain.ts](../shared/domain.ts)
- [shared/normalize.mjs](../shared/normalize.mjs)
- [shared/registry.mjs](../shared/registry.mjs)
- [tests/collector.test.mjs](../tests/collector.test.mjs)
- [tests/engine.test.mjs](../tests/engine.test.mjs)
- [tests/import.test.mjs](../tests/import.test.mjs)
- [tests/query.test.mjs](../tests/query.test.mjs)
- [tests/server.test.mjs](../tests/server.test.mjs)
- [tests/web.test.mjs](../tests/web.test.mjs)
- [tsconfig.json](../tsconfig.json)
- [web/app.js](../web/app.js)
- [web/index.html](../web/index.html)
- [web/pages.js](../web/pages.js)
- [web/scales.css](../web/scales.css)
- [web/styles.css](../web/styles.css)
- [web/ui.js](../web/ui.js)

# Bổ sung Google Sheet

- `server/google-oidc.mjs`: đăng nhập Google, PKCE/state/nonce, xác minh JWT/JWKS.
- `server/google-sheets.mjs`: service account và Google Sheets API, parser bảng quyền.
- `server/sheet-permissions.mjs`: quyền theo email, refresh và thu hồi session/token.
- `server/sheet-store.mjs`: dữ liệu nghiệp vụ, outbox/COMMIT/khôi phục.
- `server/google-runtime.mjs`, `server/google-setup.mjs`: cấu hình và khởi tạo.
- `server/migrations/002_google_identity.sql`, `003_sheet_store.sql`.
- `.env.google.example`, `docs/Permissions.csv`, `docs/GOOGLE_SHEETS.md`.
- `tests/google-oidc.test.mjs`, `google-sheets.test.mjs`, `google-auth-integration.test.mjs`, `google-setup.test.mjs`, `sheet-store.test.mjs`.
- `scripts/google-browser-smoke.mjs`: kiểm tra giao diện với OAuth/Sheet giả lập trong Chrome.

