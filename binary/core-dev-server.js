const path = require("path");
process.env.QIVRYN_DEVELOPMENT = true;

process.env.QIVRYN_GLOBAL_DIR = path.join(
  process.env.PROJECT_DIR,
  "extensions",
  ".qivryn-debug",
);

require("./out/index.js");
