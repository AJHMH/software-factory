# Versioned and signed releases

The release path has two operator-dispatched stages. Both run from `main`, reject reruns, require the exact current `main` revision, and allow only humans listed in `policies/release.yaml` under `release.authorization.authorized_actors`. This repository's `first_release_baseline` starts Conventional Commit enforcement after the earlier legacy template history. When adopting the template into a repository with a different Git history, set that field to a commit reachable from its `main` branch before release.

## One-time setup

Create a repository Actions secret named `FACTORY_GITHUB_TOKEN` containing a read-only fine-grained GitHub token for this repository. It must read Contents, Pull requests, Checks, Issues, and repository rulesets/Administration so the existing `certify` interface can verify merged-PR evidence and live protections. The secret is exposed only to the certification step. The publishing workflow uses its short-lived `GITHUB_TOKEN` with `contents: write`, `actions: read`, `id-token: write`, and `attestations: write`; it does not need a long-lived signing key or a package-registry credential.

GitHub Artifact Attestations require a supported GitHub plan: all current plans support public repositories, while private/internal repositories require GitHub Enterprise Cloud. The signer is GitHub Actions' OIDC identity for `AJHMH/software-factory/.github/workflows/factory-publish-release.yml`; signatures are short-lived Sigstore signatures. Release assets are attested in the repository's GitHub Attestations API and are verified before a draft release is made public.

## Certification stage

After merging a PR, wait for the push-to-main Factory CI run to succeed. Gather the six JSON reports required by [release certification](release-certification.md) into one object with `revision` set to the current `main` commit and report properties `validation`, `policy`, `coverage`, `security`, `sast`, and `human_review`. The five code and policy reports must describe that merged `main` revision. Human-review evidence is instead tied to the approved PR head and its original base; certification checks the current GitHub review history again. The certified revision must be the PR's exact `merge_commit_sha`; the successful CI artifact, required checks, tree, and content digests must all match it.

In Actions, run **Factory Release Certification** on `main` and provide:

- `source_revision`: the current 40-character `main` commit SHA
- `pull_request_number`: the merged PR number
- `producer_run_id`: the successful push-to-main Factory CI run ID for that SHA
- `evidence_bundle`: the JSON evidence object (under GitHub's 65,535-character workflow-dispatch limit)

The workflow verifies that the producer run belongs to this repository's Factory CI workflow, succeeded on `main` for that exact SHA, and produced the immutable source-bound artifact. It calls `factory-validation.mjs certify`; only a certified result is uploaded as `factory-release-certificate-<source-sha>-<certification-run-id>`.

## Publish stage

Run **Factory Publish Signed Release** on `main` with the same source SHA and the certification and CI run IDs. Publication validates both run records, their workflow paths and conclusions, the authorized actor, the certificate, and artifact/SBOM digests. The public `factory-validation.mjs release --mode prepare` interface derives SemVer from Conventional Commits since the newest reachable `vMAJOR.MINOR.PATCH` tag. Breaking changes take precedence over features; `feat` selects a minor version, and `fix`, `perf`, or `revert` selects a patch. Other commit types do not cause a release. `release.changelog.exclude_commit_types` controls only which commits appear in release notes.

The job serializes release attempts, rejects reruns, refuses existing tags/releases, signs all release assets with GitHub OIDC provenance, verifies the signer workflow and source revision, uploads all assets to a draft release, and publishes the draft only after the signed assets are ready. A failed run never automatically retries or overwrites a version; inspect the draft/tag and create a fresh authorized dispatch after recovery.

## Verify a release

Download the assets from the GitHub Release and use GitHub CLI to verify the provenance for each file:

```sh
gh attestation verify reference-workload.mjs --repo AJHMH/software-factory \
  --signer-workflow AJHMH/software-factory/.github/workflows/factory-publish-release.yml \
  --source-ref refs/heads/main --source-digest <source-commit-sha>
gh attestation verify sbom.spdx.json --repo AJHMH/software-factory \
  --signer-workflow AJHMH/software-factory/.github/workflows/factory-publish-release.yml \
  --source-ref refs/heads/main --source-digest <source-commit-sha>
gh attestation verify release-certificate.json --repo AJHMH/software-factory \
  --signer-workflow AJHMH/software-factory/.github/workflows/factory-publish-release.yml \
  --source-ref refs/heads/main --source-digest <source-commit-sha>
gh attestation verify release-manifest.json --repo AJHMH/software-factory \
  --signer-workflow AJHMH/software-factory/.github/workflows/factory-publish-release.yml \
  --source-ref refs/heads/main --source-digest <source-commit-sha>
```

The manifest records the version, source revision, certificate digest, artifact digest, and SBOM digest. The certificate records the merged PR, original reviewed PR head, current human approver, required checks, policy evidence, and artifact digests. Publication is a GitHub Release only; it does not deploy the workload.
