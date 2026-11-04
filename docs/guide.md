# Reading a permission snapshot

Paste a **public address**, choose a network, then inspect. Start with an offline example if you do not have an address handy. Never enter a private key or seed phrase.

| Field                     | Meaning                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary delegate         | An address with a recorded token-account allowance. One ordinary delegate can be stored per account.                                                                       |
| Remaining allowance       | The program’s recorded remaining delegated amount. It may exceed the current balance. A zero allowance can coexist with a delegate address.                                |
| Permanent delegate        | A Token-2022 mint-level authority for transfers and burns across the mint’s token accounts. A token-account owner cannot revoke it from their account.                     |
| Effective close authority | The explicit close authority, or the token-account owner when none is set. This role alone does not grant token-transfer permission. Closing still has program conditions. |
| Frozen                    | Ordinary transfers and burns are blocked until thawed. Recorded permissions still exist.                                                                                   |
| Mint freeze authority     | An address authorized to freeze or thaw accounts for the mint.                                                                                                             |
| Unverified                | The data could not be read/validated, or an extension is not interpreted. It never means “none.”                                                                           |

“Scoped reads complete” means this tool’s requested account and mint observations completed within its limits. It does not mean all possible permissions were checked or that an address is safe.

Addresses can represent individual keys, programs or multisigs. The tool does not resolve their signer rules or label addresses as trusted/malicious.

For wrapped SOL, closing an account can withdraw the underlying SOL even with a nonzero token balance. Review its effective close authority carefully. [Official close-account rules](https://solana.com/docs/tokens/basics/close-account).

“Permanent delegate” is the Token-2022 role name. It does not prove the configured address can never change; this report reads the current configuration.

## Amounts

Exports always include exact raw decimal strings. Display amounts use base mint decimals only. Interest-bearing and scaled display adjustments are not calculated. A missing mint leaves display amounts unverified while retaining raw values.

## Partial reports

A failed program read, unavailable mint, malformed account, limit or unsupported extension marks the report partial. If both token program reads fail, the lookup fails. A successfully read empty address is different from a failed scan.

Public RPC may time out or rate limit requests. Retry later or switch networks. Switching networks changes the chain being inspected; it is not a substitute for reading the original network successfully.

## Exports and privacy

JSON and Markdown exports include every decoded account, regardless of your filter or page. The report labels live RPC and fictional examples distinctly. “Copy report” copies Markdown.

The server does not save lookup history or addresses. Live queries are sent to public Solana RPC. Exported reports contain public addresses and should be shared deliberately. Offline examples make no RPC calls.

## Limits

This tool does not revoke permissions, construct transactions, inspect staking/program-specific permissions, infer historical approvals, inspect compressed assets or prove wallet safety. Most Token-2022 extensions are listed but not interpreted. There is no real-funds workflow.
