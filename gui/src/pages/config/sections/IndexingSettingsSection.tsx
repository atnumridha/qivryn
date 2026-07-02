import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext } from "react";
import { Card } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { updateConfig } from "../../../redux/slices/configSlice";
import { ConfigHeader } from "../components/ConfigHeader";
import { UserSetting } from "../components/UserSetting";
import IndexingProgress from "../features/indexing";
import { DocsSection } from "./DocsSection";

function CodebaseSubSection() {
  const config = useAppSelector((state) => state.config.config);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="mb-0 text-sm font-semibold">@codebase index</h3>
      </div>

      <Card>
        <div className="py-2">
          {config.disableIndexing ? (
            <div className="p-1">
              <p className="text-center font-semibold">Indexing is disabled</p>
            </div>
          ) : (
            <IndexingProgress />
          )}
        </div>
      </Card>
    </div>
  );
}

function EnableIndexingSetting() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  const disableIndexing = config.disableIndexing ?? false;
  const disableIndexingToggle = false;

  return (
    <div className="flex flex-col gap-4">
      <UserSetting
        title="Enable indexing"
        type="toggle"
        description={
          <div className="text-foreground">
            Allows indexing of your codebase for search and context
            understanding.
            <br />
            <br />
            Note that indexing can consume significant system resources,
            especially on larger codebases.
          </div>
        }
        value={!disableIndexing}
        disabled={disableIndexingToggle}
        onChange={(value) => handleUpdate({ disableIndexing: !value })}
      />
    </div>
  );
}

export function IndexingSettingsSection() {
  const config = useAppSelector((state) => state.config.config);
  const disableIndexing = config.disableIndexing ?? false;

  return (
    <>
      <ConfigHeader
        title="Codebase & documentation"
        subtext="Manage the local search index used for code-aware chat, retrieval, and agents."
      />

      <div className="mb-6">
        <ConfigHeader title="Local code intelligence" variant="sm" />
        <Card>
          <EnableIndexingSetting />
        </Card>
      </div>

      {!disableIndexing && (
        <div className="space-y-8">
          <CodebaseSubSection />
          <DocsSection />
        </div>
      )}
    </>
  );
}
