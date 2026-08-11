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
files at several margins using the preview packages from vitest#10912. Each free-space
margin runs once with the default 4 GiB GC threshold and once with the threshold set to
zero, which disables the workaround:

- **2-4 GiB free -> exercise sustained disk pressure at or below the default threshold.**
- **5-8 GiB free -> show whether Chromium naturally releases scratch before crossing the
  threshold.**
- **GC disabled -> provides the matching control for every free-space margin.**

Within each paired margin, the code and files are identical and only the GC threshold
differs. Push the repo or use **Run workflow**. Tune `keep_free_gb` and the file count
(`node gen.mjs <N>`) to your runner.

### Results

Observed in [GitHub Actions run 31455127600](https://github.com/hi-ogawa/reproduction-vitest-browser-disk-flake/actions/runs/31455127600):

| Configured free | Default result | GC triggers | Default minimum | Disabled result | Disabled minimum |
| ---: | --- | ---: | ---: | --- | ---: |
| 2 GiB | Pass | 150 | 1,999 MiB | Fail after 53 files | 230 MiB |
| 3 GiB | Pass | 150 | 3,030 MiB | Fail after 80 files | 0 MiB |
| 4 GiB | Pass | 150 | 4,048 MiB | Pass | 232 MiB |
| 5 GiB | Pass | 14 | 4,057 MiB | Pass | 1,324 MiB |
| 6 GiB | Pass | 4 | 4,511 MiB | Pass | 2,754 MiB |
| 7 GiB | Pass | 2 | 4,564 MiB | Pass | 3,340 MiB |
| 8 GiB | Pass | 0 | 4,650 MiB | Pass | 4,144 MiB |

The default workaround prevented failures at 2 and 3 GiB. Chromium naturally released
enough scratch space to complete the run from 4 GiB upward, although the 4 GiB disabled
case came within 232 MiB of exhaustion. The workflow is expected to fail overall because
the 2 and 3 GiB disabled controls fail.

## Estimated disk usage

In a previous GitHub Actions run without the workaround, the 50 GiB control reached a
minimum of 42,679 MiB free after running 150 files. That is roughly 8.3 GiB total, or
57 MiB per test file. Based on that measurement, 150 files need approximately 8-9 GiB
of scratch space without periodic Chromium GC.

This is a rough estimate rather than a fixed ratio because it includes browser startup
overhead and varies with Chromium, Playwright, concurrency, and the runner environment.
