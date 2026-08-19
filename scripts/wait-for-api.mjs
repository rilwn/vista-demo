const healthUrl = process.env.VISTA_API_HEALTH_URL ?? 'http://127.0.0.1:3000/api/v1/health/live';
const timeoutMs = 90_000;
const retryDelayMs = 500;
const deadline = Date.now() + timeoutMs;

process.stdout.write(`Waiting for the Vista API at ${healthUrl}...\n`);

while (Date.now() < deadline) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) {
      process.stdout.write('Vista API is ready. Starting browser applications.\n');
      process.exit(0);
    }
  } catch {
    // The API compiles on first start; retry until the bounded startup deadline.
  }
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
}

throw new Error(`Vista API did not become ready within ${timeoutMs / 1_000} seconds.`);
