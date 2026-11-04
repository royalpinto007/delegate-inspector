# Local API

Base URL: `http://127.0.0.1:4480`. No authentication; loopback only. Do not deploy this as a public service.

| Method | Path                | Result                            |
| ------ | ------------------- | --------------------------------- |
| GET    | `/api/health`       | Local service/version status      |
| GET    | `/api/examples`     | Four available fictional examples |
| GET    | `/api/examples/:id` | Decoded offline report            |
| POST   | `/api/inspections`  | Live RPC report                   |

```sh
curl http://127.0.0.1:4480/api/examples/review
curl -X POST http://127.0.0.1:4480/api/inspections \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"11111111111111111111111111111111","network":"devnet"}'
```

Live input accepts exactly `wallet` (a 32-byte base58 public address) and `network` (`mainnet` or `devnet`). No RPC URLs, keys or additional fields. The example above queries the system-program address, which may have no token accounts; it is not a sample with delegated tokens.

Responses follow `Inspection` in `src/domain/types.ts`. `schemaVersion` is `1`. Exact u64 quantities are decimal strings. `status` distinguishes complete scoped observations and partial reports. Missing mint facts use `null` plus `mintRead: "unavailable"`.

Errors: `{ "error": { "code": "RPC_TIMEOUT", "message": "..." } }`. Validation: 400; cross-origin: 403; missing resource: 404; wrong method: 405; oversized input: 413; non-JSON input: 415; invalid Host: 421; rate limits: 429; upstream failure: 502/504. Unexpected local failures return 500 without internal details.
