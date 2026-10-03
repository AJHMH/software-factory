# Testing Standards

This document outlines the testing expectations for workloads managed by the Universal Software Factory.

## 1. The Validation Plane
Testing is non-negotiable. Code that fails tests or fails to meet coverage thresholds will not pass the CI Validation Plane and will be blocked from merging.

## 2. Testing Pyramid
- **Unit Tests:** Must cover all core business logic and utility functions. They should be fast and have zero external dependencies (use mocking).
- **Integration Tests:** Must verify that modules correctly interact with one another and with external dependencies (e.g., databases, APIs).
- **End-to-End (E2E) Tests:** Required for critical user journeys.

## 3. Coverage Thresholds
- **Global Coverage:** Must be >= 80% (line and branch coverage).
- **New Code:** Any new code introduced in a PR must have >= 90% coverage.
- **Exceptions:** UI components and purely declarative configurations may have lower thresholds, subject to Review Agent approval.

## 4. Test-Driven Development (TDD)
While TDD is not strictly mandated, tests must be submitted *with* the feature code in the same PR. "I'll add tests later" is not an acceptable pattern.

## 5. Agent Instructions
- **Testing Agent:** When instructed to build a feature, the Coding Agent must either write tests or hand off to the Testing Agent to fulfill these requirements.
- **Review Agent:** Must reject any PR that introduces new business logic without corresponding tests, regardless of global coverage.