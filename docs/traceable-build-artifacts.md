# Traceable build artifacts

Factory CI runs the reference workload's install, validation, test, and build commands at the checked-out commit. The build produces `examples/reference-workload/dist/index.mjs` once. `factory-validation.mjs release-artifact --mode produce` confirms that the output bytes equal the committed workload source and packages those bytes with:

- `sbom.spdx.json`, an SPDX 2.3 inventory derived from the committed npm lockfile, including development dependencies, npm package URLs, registry tarball locations, and SHA-512 integrity values;
- `validation-evidence.json`, the exact public Factory validation report; and
- `source-evidence.json`, which binds the artifact, SBOM, validation report, workload source, manifest, lockfile, source commit, contract, profile, and tool versions by SHA-256.

The CI workflow uploads the bundle under `factory-reference-workload-<source-sha>-<run-id>` for 90 days. The release workflow runs only after a successful push-to-main Factory CI run, downloads that run's artifact, and verifies it using the public Factory Validation interface. Verification compares the downloaded artifact to the committed source and checks the SBOM against that revision's lockfile; it does not run the workload build.

To verify an artifact manually, download it from the producer run, then run from a checkout that contains the source commit:

```powershell
node scripts/factory-validation.mjs release-artifact --mode verify --trusted-revision <source-sha> --artifact-directory <downloaded-artifact-directory>
```

The hosted consumer workflow can also be dispatched on `main` with the producer run ID and the exact 40-character source revision. A missing, expired, altered, mismatched, or unsupported artifact fails closed. This workflow retains and verifies artifacts for traceability; it does not create a GitHub Release, deploy the workload, or satisfy release certification.
