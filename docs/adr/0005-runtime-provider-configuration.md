# ADR-0005: Runtime provider configuration over encrypted D1

LLM providers, models and API keys are configured at runtime in the admin
panel and stored in D1 under AES-GCM envelope encryption; the master key is a
deploy-time wrangler secret. Workers secrets are deploy-time artifacts, so
Secrets Store could not add another provider without a redeploy — defeating
runtime configuration — while plaintext D1 leaks every key on DB exposure
alone. Provider kinds are the Vercel AI SDK adapters plus one
OpenAI-compatible entry (base URL + key) covering gateways such as
OpenRouter and self-hosted endpoints.
