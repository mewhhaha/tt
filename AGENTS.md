# TT development checkpoint

The owner authorizes direct commits to main and hourly exploration of a fast,
refinement-first structural functional language. Preserve concurrent changes;
never force-push. No package publication, deployment, or changes to other
repositories are authorized.

Read docs/STATUS.md first. This branch is currently documentation-only because a
complete compiler-source upload was blocked by the repository tool. A tested local
implementation exists in the initial conversation's source archive; do not assume
it has landed, substitute a new project silently, or claim unavailable results.

LOCAL EXECUTION IS REQUIRED. The intended source snapshot supplies `dev.py verify`
and `dev.py sanitize`. Build and run in the available local environment; CI is only
optional corroboration and must not be required for compiler artifacts. Report a
missing local toolchain or source handoff honestly instead of substituting CI.

Use explicit language semantics, negative/adversarial tests, measured work and raw
performance samples. Keep shape, refinement, effects, ownership, staging, nominal
identity, and runtime representation distinct. Do not erase callable preconditions
or replace genuine descriptor providers with guesses from storage types.

Every iteration records exact commands/results and limitations. Read the complete
snapshot's DESIGN, ROADMAP, and PRODUCTION_READINESS documents when available.
Do not call the project production-ready or disable its hourly task until every
readiness gate has real evidence. Never shrink gates just to mark completion.
