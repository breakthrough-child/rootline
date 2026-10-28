// Loads .env, .env.local etc. exactly like Next.js does (same files, same precedence).
// Import this FIRST in every script: `import "./load-env";`
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
