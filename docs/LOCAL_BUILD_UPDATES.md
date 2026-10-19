# Updates for locally maintained builds

`pnpm --dir packages/electron run build:mac:local` packages the app with `nimbalystUpdatePolicy: "external"` in its installed `package.json`. This policy travels with the app, including launches from Finder, and is applied on every local rebuild. It does not depend on the launch environment or a user setting.

An externally maintained build does not start the release updater's initial or hourly checks, configure its feed, download releases, or install them on quit. Manual and IPC requests cannot override the policy, including deferred installation. **Check for Updates** explains that external build automation maintains this build. The external automation is responsible for keeping its source and patches current and deploying rebuilt apps.

Other packaging commands keep the built-in updater enabled. The local command passes the policy to electron-builder as `extraMetadata`; it does not modify the source package metadata, so a subsequent official build does not inherit the opt-out. Custom packaging pipelines can opt out with `-c.extraMetadata.nimbalystUpdatePolicy=external`. Signing and signature verification are unchanged.

The change takes effect only after deploying and launching a build containing it. It cannot stop checks or remove updates already queued by an older running app. Deployment automation should retain its existing pending-update cleanup when replacing that app.

Focused regression checks:

```sh
pnpm exec vitest run packages/electron/src/main/services/__tests__/autoUpdater.channelPolicy.test.ts packages/electron/build/__tests__/local-update-policy.test.ts
```
