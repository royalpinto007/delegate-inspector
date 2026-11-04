# Contributing

Use Node.js 22.18+, then `npm install` and `npm run demo`.

Before review:

```sh
npm run format
npm run check
npm run test:e2e
npm run package:check
npm audit
```

Keep domain logic separate from RPC and HTTP. Test actual binary data, exact u64 values, partial reads and unauthorized browser requests. Use HTTP fixtures for RPC tests; tests must not depend on public RPC availability. Browser tests run serially against a local server.

Use conventional commit messages. Do not commit secrets, exports containing personal lookup history, node_modules, builds, recordings or demo-production scripts. Keep product documentation short and link technical detail.

Do not add wallet connections, signing, automatic revocation, safety scores, hosted services or paid APIs without a separate design discussion.
