# Ownership and array publication verification — 2026-09-20

The filename follows the original feature handoff date. Publication verification
was performed on September 20, 2026, not September 18.

## Candidate and scope

Parent: `3e135945062e8c950c5fbc465f11f77edc1f9563`.
The candidate integrates the no-GC ownership and immutable array code delivered in
`tt-owned-arrays.tar.gz`. No compiler or test implementation was changed in this
publication run. The source remains dependency-free Node.js with Wasm-only output.
Existing history and unrelated files are retained; no force push is used.

The restored archive and staged Git objects have these exact directory identities:

| Directory | Git tree |
| --- | --- |
| src | ac21aff8062208fd9aed7f9484f365bd9b46bfcd |
| tests | 583d8dce238f761cc9e2374f85093da5444a159d |
| scripts | 856fc97e1e8d16a4ca3ec1388202272a3c314d6a |
| examples/array-views | 8d20b5ba3e85c3e4b737728ef724ce8995eb19db |
| examples/ownership-frames | 753e61d1dff2f1f375fe1c3a11003d4816b040fb |

The older example directories are retained from the parent; their executable
source/runner inputs were restored, while their nonexecuted README files were not.
All benchmark drivers exercised by the verifier match their published blobs. Some
older comparison-only drivers and historical documents were not restored locally.
Accordingly this is exact restored-source/test verification, not a full clean clone.

## Commands and observed results

Node v22.16.0 / V8 12.4.254.21-node.26 / Linux x64. No npm installation, Python,
native compiler, CI artifact, hosted checker or network was needed for execution.

```sh
npm test
npm run verify
```

Both commands succeeded locally. The suite passes 290/290 with zero failures or
skips. The verifier also passes original examples/README/standalone Wasm, compiler
work gates at 500/1000/2000, the map/fold runtime check, module/effect benchmarks,
ownership/array work gates, and pure/host runners.

The 10,000-frame owner examples preserve the initial snapshot, return checksum
40030, reuse blocks 9999 times, and finish with zero live owned bytes. The host
variant invokes its explicit capabilities 40000 times. Array examples preserve
`[10,20,30,40]`, produce `[10,99,30,40]`, read rotatedFirst=30 and joinedLength=4;
host mode performs two callbacks. These are correctness checks, not production
qualification or a claim of universally zero-cost immutable updates.

Local logs and new raw benchmark outputs accompany the publication response.
No prior benchmark timing is relabeled as a new result.

## Historical evidence formatting

`array-inputs.json`, `array-views.json`, `array-compatibility.json` and
`ownership-inputs.json` preserve the supplied historical JSON values; whitespace
is compacted. Their original dates and unpublished-at-the-time descriptions remain
historical provenance rather than current branch status.

`ownership.json` uses an explicitly labeled schema-2 selected report: all historical
runtime records and raw total/ownership compilation samples are retained. Repeated
per-sample counters and other compile phase series are omitted, not modified.
The file identifies the full original report by SHA-256; the full report remains
in the supplied `tt-owned-arrays.tar.gz`, and `benchmarks/ownership.mjs` reproduces
the full format. This avoids publishing a numerically mistranscribed historical
report while retaining its raw measurements and memory/cost qualifications.

The earlier September 18 iteration notes describe the attempts made on that date.
This commit supersedes their publication-blocked status, not their stated limitations.
The README and STATUS describe the integrated feature set. Production gates remain
unchanged. Broader ownership, shared snapshot representation, general continuation
handlers and runtime qualification are not claimed complete.
