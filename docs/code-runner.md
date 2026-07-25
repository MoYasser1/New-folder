# Code runner

`POST /api/code/run` is authenticated and rate-limited. The local runner exists only for development and is rejected when `NODE_ENV=production`.

Local controls include source-size and output limits, a hard timeout, isolated Python mode, restricted builtins, no inherited application secrets, and rejection of imports, files, sockets, subprocesses, dynamic execution, and dunder access.

Production must use `CODE_RUNNER_PROVIDER=remote` with a dedicated sandbox service providing:

- disposable containers or microVMs;
- no network by default;
- read-only base filesystem and ephemeral workspace;
- non-root user;
- CPU, memory, process, disk, output, and wall-clock limits;
- per-submission isolation and deletion;
- signed service-to-service authentication.

The API stores only bounded output and submission metadata. Never deploy the local process runner on an internet-facing production host.
