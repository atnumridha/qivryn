import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Divider } from "../../components/ui/Divider";
import { TabGroup } from "../../components/ui/TabGroup";
import { useNavigationListener } from "../../hooks/useNavigationListener";
import { bottomTabSections, getAllTabs, topTabSections } from "./configTabs";
import { AccountDropdown } from "./features/account/AccountDropdown";
import "./config.css";

function ConfigPage() {
  useNavigationListener();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "settings";

  const allTabs = getAllTabs();

  const handleTabClick = (tabId: string) => {
    if (tabId === "back") {
      navigate("/");
    } else {
      navigate(`/config?tab=${tabId}`);
    }
  };

  return (
    <div className="qivryn-config-page flex h-full flex-row overflow-hidden">
      {/* Vertical Sidebar - full height */}
      <div className="qivryn-config-nav bg-vsc-background flex w-12 flex-shrink-0 flex-col border-0 md:w-56">
        <div className="qivryn-config-nav-inner border-r-border flex flex-1 flex-col overflow-y-auto border-b-0 border-l-0 border-r-2 border-t-0 border-solid p-2 text-xs">
          {topTabSections.map((section) => (
            <React.Fragment key={section.id}>
              <TabGroup
                tabs={section.tabs}
                label={section.label}
                activeTab={activeTab}
                onTabClick={handleTabClick}
                showTopDivider={section.showTopDivider}
                showBottomDivider={section.showBottomDivider}
                className={section.className}
              />
            </React.Fragment>
          ))}

          <div className="flex-1" />

          {bottomTabSections.map((section) => (
            <TabGroup
              key={section.id}
              tabs={section.tabs}
              label={section.label}
              activeTab={activeTab}
              onTabClick={handleTabClick}
              showTopDivider={section.showTopDivider}
              showBottomDivider={section.showBottomDivider}
              className={section.className}
            />
          ))}

          <Divider />

          <AccountDropdown />
        </div>
      </div>

      {/* Main content area */}
      <div className="qivryn-config-content flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="qivryn-config-scroll thin-scrollbar relative block flex-1 overflow-y-auto">
          <div className="qivryn-config-body space-y-6 px-4 py-4">
            {allTabs.find((tab) => tab.id === activeTab)?.component}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigPage;
