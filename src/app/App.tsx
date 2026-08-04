import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"

import { AppHeader } from "@/components/layout/AppHeader"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { BatchView } from "@/components/views/BatchView"
import { CoverView } from "@/components/views/CoverView"
import { DashboardView } from "@/components/views/DashboardView"
import { GeneratorView } from "@/components/views/GeneratorView"
import { HistoryView } from "@/components/views/HistoryView"
import { LibraryView } from "@/components/views/LibraryView"
import { MaterialsProvider } from "@/hooks/use-materials"
import { PATH_TO_TAB, TAB_PATHS, TAB_TITLES } from "@/types/nav"

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = PATH_TO_TAB[location.pathname] ?? "dashboard"

  return (
    <MaterialsProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar />
        <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-background">
          <AppHeader title={TAB_TITLES[activeTab]} />
          <div className="flex-1 overflow-y-auto p-8">
            <Routes>
              <Route
                path={TAB_PATHS.dashboard}
                element={
                  <DashboardView
                    onGoHistory={() => navigate(TAB_PATHS.history)}
                    onGoLibrary={() => navigate(TAB_PATHS.library)}
                    onGoGenerator={() => navigate(TAB_PATHS.generator)}
                  />
                }
              />
              <Route
                path={TAB_PATHS.library}
                element={
                  <LibraryView
                    onGoGenerator={() => navigate(TAB_PATHS.generator)}
                  />
                }
              />
              <Route
                path={TAB_PATHS.generator}
                element={
                  <GeneratorView
                    onGoLibrary={() => navigate(TAB_PATHS.library)}
                  />
                }
              />
              <Route
                path={TAB_PATHS.batch}
                element={
                  <BatchView onGoLibrary={() => navigate(TAB_PATHS.library)} />
                }
              />
              <Route path={TAB_PATHS.cover} element={<CoverView />} />
              <Route path={TAB_PATHS.history} element={<HistoryView />} />
              <Route
                path="*"
                element={<Navigate to={TAB_PATHS.dashboard} replace />}
              />
            </Routes>
          </div>
        </main>
      </div>
    </MaterialsProvider>
  )
}

export default App
