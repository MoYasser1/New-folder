# Performance budgets

- Initial compressed JavaScript: under 100 kB for the current web shell.
- Initial compressed CSS: under 20 kB.
- Public pages: no horizontal overflow at supported desktop/mobile widths.
- API p95 target: 300 ms for catalog/auth reads excluding third-party latency.
- Video progress writes: client throttled and server upserted; production should batch at 10–15 second intervals.
- Code execution and AI calls are isolated from request workers in production.

The production pipeline should add Lighthouse CI against the deployed preview with targets of LCP ≤ 2.5 s, CLS ≤ 0.1, and INP ≤ 200 ms at the 75th percentile.
