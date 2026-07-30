import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

function findAndLoadEnv() {
  let currentDir = process.cwd();
  // Windows drive letter 정규화
  const fileDir = dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1'); 
  
  const dirsToSearch = [currentDir, fileDir];
  for (let startDir of dirsToSearch) {
    let dir = startDir;
    while (true) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) {
        process.loadEnvFile(envPath);
        return;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

findAndLoadEnv();
