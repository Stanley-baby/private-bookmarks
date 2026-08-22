# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repo root, or
- `CONTEXT-MAP.md` at the repo root if it exists; read each linked context relevant to the topic.
- ADRs under `docs/adr/` that touch the area being changed.

If these files do not exist, proceed silently. `/domain-modeling` creates them lazily when terminology or decisions are resolved.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use terms as defined in `CONTEXT.md` in issues, tests, hypotheses, and implementation notes. If a needed concept is missing, reconsider whether new language is necessary or record the gap for `/domain-modeling`.

## Flag ADR conflicts

Surface contradictions with an existing ADR explicitly rather than silently overriding the decision.
