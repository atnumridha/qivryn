import { RouterProvider, createMemoryRouter } from "react-router-dom";
import Layout from "./components/Layout";
import { MainEditorProvider } from "./components/mainInput/TipTapEditor";
import { SubmenuContextProvidersProvider } from "./context/SubmenuContextProviders";
import { VscThemeProvider } from "./context/VscTheme";
import ParallelListeners from "./hooks/ParallelListeners";
import ConfigPage from "./pages/config";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import History from "./pages/history";
import Stats from "./pages/stats";
import Agents from "./pages/agents";
import Review from "./pages/review";
import TerminalAssistant from "./pages/terminal";
import BrowserWorkspace from "./pages/browser";
import SlackConnector from "./pages/slack";
import ThemePage from "./styles/ThemePage";
import { persistWebviewRoute, ROUTES } from "./util/navigation";

const routes = [
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/index.html",
        element: <Chat />,
      },
      {
        path: ROUTES.HOME,
        element: <Chat />,
      },
      {
        path: "/history",
        element: <History />,
      },
      {
        path: ROUTES.STATS,
        element: <Stats />,
      },
      {
        path: ROUTES.AGENTS,
        element: <Agents />,
      },
      {
        path: ROUTES.REVIEW,
        element: <Review />,
      },
      {
        path: ROUTES.TERMINAL,
        element: <TerminalAssistant />,
      },
      {
        path: ROUTES.BROWSER,
        element: <BrowserWorkspace />,
      },
      {
        path: ROUTES.SLACK,
        element: <SlackConnector />,
      },
      {
        path: ROUTES.CONFIG,
        element: <ConfigPage />,
      },
      {
        path: ROUTES.THEME,
        element: <ThemePage />,
      },
    ],
  },
];

const initialRoute =
  (window as any).initialRoute ||
  (import.meta.env.DEV
    ? window.location.pathname + window.location.search
    : "") ||
  ROUTES.HOME;
const router = createMemoryRouter(routes, {
  initialEntries: [initialRoute],
});

router.subscribe(({ location }) => {
  persistWebviewRoute(`${location.pathname}${location.search}${location.hash}`);
});

/*
  ParallelListeners prevents entire app from rerendering on any change in the listeners,
  most of which interact with redux etc.
*/
function App() {
  return (
    <VscThemeProvider>
      <MainEditorProvider>
        <SubmenuContextProvidersProvider>
          <RouterProvider router={router} />
        </SubmenuContextProvidersProvider>
      </MainEditorProvider>
      <ParallelListeners />
    </VscThemeProvider>
  );
}

export default App;
