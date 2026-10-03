# Security Standards

This document establishes the baseline security requirements enforced by the Factory Security Plane.

## 1. Secure by Default
- **No Hardcoded Secrets:** Never commit passwords, API keys, or tokens. The Validation Plane will block any PR containing secrets via automated secret scanning.
- **Principle of Least Privilege:** Services, containers, and IAM roles must only request the permissions strictly necessary for their function.

## 2. Dependency Management
- **Vulnerability Scanning:** Software Composition Analysis (SCA) is mandatory. High and Critical vulnerabilities will block releases.
- **Automated Updates:** The Factory uses automated bots to open PRs for minor and patch updates.
- **Pinning:** Dependencies in production builds must be pinned to specific versions or tightly bounded ranges.

## 3. Code Security
- **Input Validation:** All external input (API requests, file uploads, user data) must be rigorously validated and sanitized.
- **Static Analysis:** Static Application Security Testing (SAST) runs on every PR. Findings must be triaged or remediated before merge.

## 4. Agent Instructions
- **Security Agent:** When a vulnerability is found, the Security Agent should be triggered to auto-remediate the issue and open a fix PR.
- **Coding Agent:** Must prioritize secure coding patterns over performance optimization when dealing with user input or authentication flows.