export const layoutTarget = "src/vs/workbench/browser/layout.ts";
export const sidebarPartTarget =
  "src/vs/workbench/browser/parts/sidebar/sidebarPart.ts";

const layoutMarker = "// Qivryn Codie-density sidebar";
const sidebarMarker = "// Qivryn Codie-density minimum";

export function applyQivrynLayoutDimensions(source) {
  if (source.includes(layoutMarker)) {
    return source
      .replace(
        `SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 280), ${layoutMarker}`,
        `SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 256), ${layoutMarker}`,
      )
      .replaceAll(
        "Math.min(280, mainContainerDimension.width / 4)",
        "Math.min(256, mainContainerDimension.width / 4)",
      )
      .replaceAll(
        "Math.min(280, configuration.mainContainerDimension.width / 4)",
        "Math.min(256, configuration.mainContainerDimension.width / 4)",
      );
  }
  const anchor = `SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),`;
  if (!source.includes(anchor)) {
    throw new Error(
      "Pinned Code - OSS anchor not found for sidebar default width",
    );
  }
  let transformed = source.replace(
    anchor,
    `SIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 256), ${layoutMarker}`,
  );
  transformed = transformed.replaceAll(
    "Math.min(300, mainContainerDimension.width / 4)",
    "Math.min(256, mainContainerDimension.width / 4)",
  );
  transformed = transformed.replaceAll(
    "Math.min(300, configuration.mainContainerDimension.width / 4)",
    "Math.min(256, configuration.mainContainerDimension.width / 4)",
  );
  return transformed;
}

export function applyQivrynSidebarMinimum(source) {
  if (source.includes(sidebarMarker)) {
    return source.replace(
      `return Math.max(width, 280);`,
      `return Math.max(width, 256);`,
    );
  }
  const anchor = `		return Math.max(width, 300);`;
  if (!source.includes(anchor)) {
    throw new Error(
      "Pinned Code - OSS anchor not found for sidebar minimum width",
    );
  }
  return source.replace(
    anchor,
    `		${sidebarMarker}\n\t\treturn Math.max(width, 256);`,
  );
}
