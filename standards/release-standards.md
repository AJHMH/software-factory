# Release Standards

This document outlines the procedures and requirements for certifying and publishing releases via the Release Plane.

## 1. Semantic Versioning
- All workloads must strictly adhere to Semantic Versioning (SemVer: `MAJOR.MINOR.PATCH`).
- **MAJOR:** Incompatible API changes.
- **MINOR:** Backward-compatible new functionality.
- **PATCH:** Backward-compatible bug fixes.

## 2. Conventional Commits
- Version numbers and changelogs are generated automatically based on commit messages.
- You must use Conventional Commits (e.g., `feat:`, `fix:`, `BREAKING CHANGE:`).

## 3. Release Certification
Before a release artifact is generated, the code must successfully pass:
1. The CI Validation Plane (Tests & Build).
2. The Security Plane (SAST & Secret Scanning).
3. The required human or Review Agent approvals defined in `policies/governance.yaml`.

## 4. Agent Instructions
- **Release Agent:** Automatically triggered on merge to `main`. It evaluates the commit history, determines the next semantic version, tags the repository, and publishes the release notes.