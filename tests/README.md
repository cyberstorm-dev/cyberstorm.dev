# Tests

Run all tests before deploying to any environment.

## CLM Integrity Tests

Verifies on-chain CLM attestations are correct:

```bash
node tests/clm-integrity.test.mjs
```

**Must pass before deploy:**
- All expected sections present
- Content hashes exist
- Parent UIDs resolve to valid attestations
- Tree hierarchy is correct
- Root sections have no parent

## Current Status

**FAILING** - 66 failures due to broken parent UIDs in on-chain attestations.

The attestations were created with parent bytes32 values that don't match any attestation UIDs, breaking the tree structure.

## Running Tests

```bash
cd ~/.openclaw/projects/cyberstorm.dev
node tests/clm-integrity.test.mjs
```

Exit code 0 = all tests pass, safe to deploy.
Exit code 1 = failures, DO NOT deploy.
