# Contributing to daily-paper-reader

Welcome! This document helps you get started with development.

## Prerequisites

- **Node.js** 20+ (LTS)
- **Python** 3.11+
- **Git**

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/daily-paper-reader.git
   cd daily-paper-reader
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run pre-dev setup (generates types, syncs content):
   ```bash
   npm run predev
   ```

4. Start development server:
   ```bash
   npm run dev
   ```

## Testing

Run all tests:
```bash
npm test
```

Run specific test files:
```bash
node astro-src/scripts/test-runner.mjs --filter outline
```

Run with tap reporter:
```bash
node astro-src/scripts/test-runner.mjs --reporter tap
```

## Code Style

- Use ESLint: `npm run lint`
- Format with Prettier (included in lint)

## Commit Convention

We use **Conventional Commits** with R7 tracking:

```
<type>(<scope>): <description> (R7 <section>.<task>.<subtask>)

Examples:
feat(core): add paper parser (R7 A.1.1)
fix(ui): resolve theme toggle (R7 C.2.3)
ci(workflows): add cache (R7 E.1.2)
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `ci` - CI/CD changes
- `test` - Test additions
- `refactor` - Code refactoring
- `perf` - Performance

### R7 Sections
- A. Core/Architecture
- B. Data/Pipeline
- C. UI/Frontend
- D. Docs/Content
- E. DevOps/Infra
- F. Testing/QA
- G. Performance
- H. Security
- I. Release/Version
- J. Meta/Process

## PR Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes following the commit convention

3. Push and create a Pull Request:
   ```bash
   git push -u origin feat/my-feature
   ```

4. CI will run checks (tests, lint, type check)

5. Address any review feedback

6. Squash and merge when approved

## Resources

- [Project README](./README.md)
- [Testing Guide](./tests/README.md)
- [Architecture Docs](./docs/architecture.md)
