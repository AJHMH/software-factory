# Controlled reference artifact promotion

`Factory Promote Reference` promotes an already published, certified release. It downloads the four immutable release assets (`reference-workload.mjs`, `sbom.spdx.json`, `release-certificate.json`, and `release-manifest.json`), verifies their GitHub attestations and digest bindings, and never builds or modifies the workload.

## One-time GitHub setup

Create a GitHub Actions Environment named `reference` under the repository's **Settings → Environments**. Add the owner as a required reviewer, leave **Prevent self-review** disabled so the single developer can approve their own dispatch, disable administrator bypass where the organization plan permits it, and restrict deployment branches to `main`. Only the `promote` job targets this environment; its evidence step cannot run until GitHub releases the job after environment protection succeeds. The workflow also restricts requests to the configured release actor, first-attempt `workflow_dispatch` runs from `main`, and source commits reachable from the exact trusted `main` revision. GitHub only offers required-reviewer environment protection on supported repository plans; confirm the `reference` environment actually displays the required reviewer rule, especially for private repositories.

The workflow's top-level token is read-only. The promotion job receives only Contents: read, Actions: read, and Deployments: write. It uses no repository secret, cloud credential, or long-lived deployment key. The job serializes promotions per environment and refuses an outdated trusted `main` revision after approval.

## Running a promotion

From **Actions → Factory Promote Reference → Run workflow**, choose `reference` and provide the published semantic tag (for example `v1.2.3`) and the exact source commit named in its release manifest. GitHub pauses at the protected `reference` Environment for the required human review. A denied or missing approval prevents the deployment job from running.

The workflow checks the source-bound GitHub attestations, deployment policy, certificate, manifest, workload and SBOM digests, and migration compatibility before copying the exact files. The filesystem adapter is the template's provider-neutral reference target: the successful package is retained as a 90-day workflow artifact, while a GitHub Deployment record stores its digest, source revision, version, environment, approval identity, health result, previous stable release, and outcome. This is a controlled reference package, not a long-running application service or a production-cloud deployment.

The first deployment records no previous stable package. Later deployments read the last successful matching GitHub Deployment. Duplicate tag promotion and overlapping runs are refused. The adapter emits `promotion.started`, `artifact.verified`, `promotion.health_check`, and `promotion.completed` metric events; denied attempts emit `promotion.denied`.

## Extending the adapter

The trusted `policies/deployment.yaml` declares adapter identity, protected environment, approval provider, least-privilege permissions, required release assets, integrity health checks, allowed migration strategies, and external-secret names (empty for this adapter). The current policy supports the `none` migration strategy and requires compatibility metadata in the signed release manifest. New adapters must preserve immutable artifact identity, environment approval, mutual exclusion, health and migration checks, prior-stable recording, and deployment outcome evidence. Do not add cloud-specific credentials or production targets without a separate reviewed design and policy change.
