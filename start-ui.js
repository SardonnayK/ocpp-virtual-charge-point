#!/usr/bin/env node

/**
 * Quick Start Script for OCPP VCP UI
 *
 * This script helps you get started with the OCPP Virtual Charge Point UI.
 */

const { spawn } = require("child_process");
const os = require("os");

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ⚡ OCPP Virtual Charge Point Manager                        ║
║                                                               ║
║   Starting the Web UI...                                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

// Determine the shell based on OS
const isWindows = os.platform() === "win32";
const shell = isWindows ? "cmd.exe" : "/bin/bash";
const npmCommand = isWindows ? "npm.cmd" : "npm";

// Start the UI
const ui = spawn(npmCommand, ["run", "ui"], {
  stdio: "inherit",
  shell: true,
});

ui.on("error", (err) => {
  console.error("❌ Failed to start UI:", err);
  process.exit(1);
});

ui.on("close", (code) => {
  if (code !== 0) {
    console.error(`❌ UI process exited with code ${code}`);
  }
  process.exit(code);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Shutting down UI server...");
  ui.kill("SIGINT");
});

process.on("SIGTERM", () => {
  console.log("\n\n👋 Shutting down UI server...");
  ui.kill("SIGTERM");
});

// Give it a moment then print instructions
setTimeout(() => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ✅ UI Server Started!                                       ║
║                                                               ║
║   🌐 Open your browser to:                                    ║
║      http://localhost:3001                                    ║
║                                                               ║
║   📚 Documentation:                                           ║
║      See UI-GUIDE.md for full instructions                    ║
║                                                               ║
║   ⏹️  Press Ctrl+C to stop                                    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
}, 2000);
