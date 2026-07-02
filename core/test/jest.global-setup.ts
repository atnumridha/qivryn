import fs from "fs";
import path from "path";

// Sets up the GLOBAL directory for testing - equivalent to ~/.qivryn
// IMPORTANT: the QIVRYN_GLOBAL_DIR environment variable is used in utils/paths for getting all local paths
export default async function () {
  process.env.QIVRYN_GLOBAL_DIR = path.join(__dirname, ".qivryn-test");
  if (fs.existsSync(process.env.QIVRYN_GLOBAL_DIR)) {
    fs.rmSync(process.env.QIVRYN_GLOBAL_DIR, {
      recursive: true,
      force: true,
    });
  }
}
