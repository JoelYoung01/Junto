import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function viteReady() {
  try {
    const response = await fetch("http://localhost:5173/");
    return response.ok;
  } catch {
    return false;
  }
}

if (await viteReady()) {
  console.log("[junto] Vite already running at http://localhost:5173");
  process.exit(0);
}

const child = spawn("pnpm", ["--dir", "ui", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
