// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a QivrynConfig

import { ConfigResult } from "@qivryn/config-yaml";
import { QivrynConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the QivrynConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<QivrynConfig>>;
  setIsActive(isActive: boolean): void;
}
