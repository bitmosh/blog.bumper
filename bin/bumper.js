#!/usr/bin/env node
import { existsSync } from "node:fs";
import process from "node:process";
if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch {}
}
await import("../dist/cli.js");