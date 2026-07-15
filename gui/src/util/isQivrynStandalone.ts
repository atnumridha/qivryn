// A maximized Qivryn WebviewView does not receive VS Code's fullscreen flag.
// Its available canvas is still a standalone surface, so use viewport width as
// the fallback signal and keep every route in that surface responsive.
export const STANDALONE_VIEWPORT_MIN_WIDTH = 960;

export function isQivrynStandalone(): boolean {
  return (
    Boolean((window as any).isFullScreen) ||
    document.body.dataset.qivrynFullscreen === "true" ||
    window.innerWidth >= STANDALONE_VIEWPORT_MIN_WIDTH
  );
}
