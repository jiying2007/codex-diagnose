# Verify a release

Codex Diagnose Safe releases are expected to use immutable GitHub Releases with SHA-256 and GitHub build-provenance attestation.

For `v1.0.0`:

```bash
gh release download v1.0.0 -R jiying2007/codex-diagnose
sha256sum -c SHA256SUMS
gh release verify v1.0.0 -R jiying2007/codex-diagnose
gh release verify-asset v1.0.0 codex-diagnose-safe-1.0.0.tgz -R jiying2007/codex-diagnose
gh attestation verify codex-diagnose-safe-1.0.0.tgz -R jiying2007/codex-diagnose
```

Also verify the source tag and current release commit agree with the intended release SHA, and inspect `product-contract.json` to confirm the exact Safe Core pin.

The package must not include `.github`, tests, scripts, `.gitmodules`, Core tests/workflows/package metadata or any secret material.
