# API Documentation

The NestJS application exposes versioned routes below `/api/v1` and interactive
OpenAPI at `/api/docs`. The raw document is served at `/api/docs-json`.

Generate the same document without opening a network listener:

```sh
npm run openapi:generate -w @vista/api
```

The generated `apps/api/openapi.json` is a build artifact and is intentionally
ignored. CI regenerates it to catch metadata/configuration failures. Published
API compatibility and generated clients will be added as versioned domain
operations begin.
