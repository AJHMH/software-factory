# Documentation Standards

This document outlines the expectations for the Knowledge Plane within the Universal Software Factory. 

## 1. Knowledge is Infrastructure
Documentation is not an afterthought; it is treated as critical infrastructure that enables both humans and AI Agents to understand the workload.

## 2. Required Documentation
Every workload must maintain the following in its `docs/` directory:
- `architecture.md`: High-level system design and decision records (ADRs).
- `operations.md`: Runbooks, deployment topology, and health check definitions.
- `security.md`: Threat models and specific security considerations.

## 3. The README
The repository `README.md` must clearly state:
1. What the project does.
2. How to run it locally.
3. How to execute the Factory Contract commands (`install`, `validate`, `test`, `build`).

## 4. Agent Instructions
- **Context Gathering:** AI Agents rely heavily on the `docs/` folder to understand the project architecture. If the docs are stale, the agents will make mistakes.
- **Auto-Generation:** When significant architectural changes are made, the Coding Agent must also update the corresponding documentation in the same PR.