# vitest-browser-disk-flake

Minimal reproduction of [vitest#9437](https://github.com/vitest-dev/vitest/issues/9437)
and verification of the workaround in [vitest#10912](https://github.com/vitest-dev/vitest/pull/10912):
Vitest browser mode fails a test file when the runner runs out of disk, with the misleading

```
Cannot connect to the iframe … Received URL: unknown due to CORS
Failed to fetch dynamically imported module
```

Every test file here renders only an empty `<div>` — no framework, mocking, setup, or
coverage — so nothing but disk can be the cause.

## Mechanism

1. Playwright runs Chromium with `--disable-dev-shm-usage` (its default), putting
   Chromium's shared-memory scratch in `/tmp` (disk) instead of `/dev/shm`.
2. Each `/tmp/.org.chromium.Chromium.*` file is created, `mmap`ed, then `unlink`ed:
   deleted-but-open — invisible to `du`/`ls`, still counted by `df`, freed only when the
   process closes the fd.
3. With `isolate: true` (default) every test file gets a fresh iframe/renderer, but one
   long-lived Chromium serves them all and holds those fds for the whole run — so scratch
   **accumulates** instead of freeing between files.
4. When `df` hits 0 the iframe's module write fails with `ENOSPC`; vitest surfaces it as
   the misleading `Received URL: unknown due to CORS`.

## Reproduce

Free disk is exhausted only when it's smaller than the browser's scratch demand, which is
why real CI hits this intermittently. [`repro.yml`](.github/workflows/repro.yml) makes it
deterministic: it fills disk to a fixed margin (a ballast file), then runs the same 150
files at several margins using the preview packages from vitest#10912:

- **2 GB free -> passes with Chromium GC** because Vitest detects disk pressure and frees
  the browser's accumulated scratch data between files.
- **4, 8, and 16 GB free -> exercise behavior around the 4 GB GC threshold.**
- **50 GB free -> passes without Chromium GC** as the control.

Same code, same files; only free disk differs. Push the repo or use **Run workflow**.
Tune `keep_free_gb` and the file count (`node gen.mjs <N>`) to your runner.
