# Factory public visibility review

Reviewed on 2026-10-04 before the owner-authorized private-to-public change.
The published main revision was `8a47c9857d78e223a642d459d58c4690a60838c4`.

The exposed repository contains Factory tooling, workflow/policy/schema definitions,
operator documentation, reference workloads, tests, Git history, issues, and PRs.
Documentation includes the GitHub App identity, installation identifiers, and owner
login; these are identifiers, not authentication credentials. No App PEM, token,
tracked credential file, or private environment configuration was found.

The checksum-pinned Gitleaks 8.30.1 scanner completed successfully with zero findings
across all fetched branches/tags and published pull-request head refs 21 through 46.
Reports were written redacted to ignored local scratch files. GitHub secret-scanning
alerts returned an empty collection. The only code-scanning alert returned was
medium severity and marked fixed. Sensitive credentials remain outside GitHub and
the repository. Test-only approval fixtures do not grant actual review authority.

This review cannot guarantee that every detector recognizes every possible secret.
The review found no blocker to the requested publication. The visibility change was
performed and confirmed as `PUBLIC`; it did not remove review requirements or
modify required checks.
