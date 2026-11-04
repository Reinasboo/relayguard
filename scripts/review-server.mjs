// A reproducible reviewer entry point. No private key, Supabase account or funds required.
process.env.RELAYGUARD_REVIEW_ONLY = "true";
await import("../dist/src/server.js");
console.log("Read-only reviewer walkthrough: http://127.0.0.1:4173/review");
