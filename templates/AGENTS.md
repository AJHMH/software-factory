# Factory Agents Configuration

This file configures the behavior of the Universal Software Factory AI Agents for this specific repository.

## Agent Context
- **Primary Framework:** [e.g., React, Express, Spring Boot]
- **Architectural Style:** [e.g., Microservice, Monolith, CLI tool]

## Coding Agent Hints
- Prefer functional components over class components.
- Use `logger.info()` instead of `console.log()` for all outputs.

## Testing Agent Hints
- Use `jest` for unit tests.
- Do not attempt to mock the `database` module; use the in-memory sqlite instance configured in `tests/setup.js`.

## Operations Agent Hints
- If the `/health` endpoint fails, check the Redis connection first.