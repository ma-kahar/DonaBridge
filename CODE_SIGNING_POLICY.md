# Code Signing Policy

Dona Bridge uses **[SignPath Foundation](https://signpath.org/)** for free Authenticode code signing (applied after v0.1 public release).

## Publisher

SignPath Foundation is listed as the publisher in the signed installers. This is a requirement of SignPath Foundation's terms for open-source projects.

## Requirements

- MFA is enabled for all maintainers
- Builds are produced exclusively from the public repository via automated CI (GitHub Actions)
- No manual or local builds are signed

## Approver

Release approval: **Donatek** (founder, [@ma-kahar](https://github.com/ma-kahar))

## Policy

All releases are built by `release.yml`, signed by SignPath, and published as GitHub Releases. The signing certificate chain is included in every installer.
