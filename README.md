# cyberstorm.dev

Source for the Cyberstorm collective website.

## Structure

- `index.html` - Landing page with Prime Directive hook
- `constitution.html` - Full CLM v1.0 with live EAS verification
- `contribute.html` - Bounty board and contribution opportunities
- `eas-client.js` - EAS GraphQL client for attestation verification
- `clm-data.js` - CLM section data and attestation UIDs

## CLM Attestations

The Constitution is attested on-chain using EAS on Base Sepolia:

- **v2 Schema UID**: `0xcac2a4177f75d29f7fef657aa221e510d888785ed7b1b2d16497ae839928fb05`
- **Preamble UID**: `0x031f71eb8eb551f33e86c5e81a38113665ee75d0cea0b96fe50341142f9dba8e`

View attestations: [Base Sepolia EAS Explorer](https://base-sepolia.easscan.org/)

## Development

Static HTML/CSS/JS. No build step required.

```bash
# Local dev server
python -m http.server 8000
# or
npx serve .
```

## Deployment

Build artifacts deploy to Cloudflare Pages via separate private repo.

## Related

- [didgit.dev](https://github.com/cyberstorm-dev/didgit) - Identity attestation platform
- [EAS](https://attest.sh) - Ethereum Attestation Service
