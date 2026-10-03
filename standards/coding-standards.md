# Coding Standards

This document defines the structural and behavioral coding standards for all workloads within the Universal Software Factory. These standards apply to **both humans and AI Agents**.

## 1. Principles
- **Readability over Cleverness:** Code must be easily readable by humans and agents. Avoid obscure language features.
- **Predictability:** Use established design patterns. Do not invent custom paradigms for standard problems.
- **No Broken Windows:** If you touch a file and see a linting error or poor pattern, fix it.

## 2. Pull Request Guidelines (Small PRs)
- **Scope Limit:** PRs must do exactly one thing. Do not mix feature development, refactoring, and dependency bumps in a single PR.
- **Size Limit:** Aim for under 400 lines of code changed per PR (excluding generated files).
- **Commit Messages:** Must strictly follow Conventional Commits (e.g., `feat:`, `fix:`, `chore:`, `refactor:`).

## 3. Code Cleanliness
- **Formatting:** All repositories must use an automated formatter (e.g., Prettier, Black, gofmt). Code that fails the formatting check will be rejected by the CI Validation Plane.
- **Linting:** Zero warnings. Warnings are treated as errors.
- **Naming:** 
  - Variables and functions: Descriptive and unambiguous. Avoid single-letter variables except for iterators.
  - Boolean variables: Should read as a question (e.g., `isReady`, `hasData`).

## 4. Documentation in Code
- Document **WHY**, not **WHAT**.
- Complex algorithms must have a block comment explaining the approach.
- Public APIs (functions, classes, interfaces) must have standard docstrings (e.g., JSDoc, Python Docstrings).

## 5. Agent Instructions
- **Agent Reviews:** The Review Agent will strictly enforce these rules. If an agent requests changes based on these standards, you must address them.
- **Automated Fixes:** If the Factory Remediation Agent modifies your code to meet these standards, do not revert it without an architectural exception.