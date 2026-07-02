import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

export const env = {
  apiBase:
    process.env.QIVRYN_API_BASE ??
    process.env.CONTINUE_API_BASE ??
    "https://api.qivryn.ai/",
  qivrynHome:
    process.env.QIVRYN_GLOBAL_DIR ||
    process.env.CONTINUE_GLOBAL_DIR ||
    path.join(os.homedir(), ".qivryn"),
};
