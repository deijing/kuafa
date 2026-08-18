import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"

import { AppHeader } from "@/components/layout/AppHeader"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { BatchView } from "@/components/views/BatchView"
import { BgmView } from "@/components/views/BgmView"
import { CoverView } from "@/components/views/CoverView"
import { DashboardView } from "@/components/views/DashboardView"
import { GeneratorView } from "@/components/views/GeneratorView"
import { HistoryView } from "@/components/views/HistoryView"
import { LibraryView } from "@/components/views/LibraryView"
import { ToastContainer } from "@/components/layout/ToastContainer"
import { ActiveJobBanner } from "@/components/layout/ActiveJobBanner"
import { MaterialsProvider } from "@/hooks/materials-provider"
import { NotificationProvider } from "@/hooks/notifications-provider"
import { JobsProvider } from "@/hooks/jobs-provider"
import { PATH_TO_TAB, TAB_PATHS, TAB_TITLES } from "@/types/nav"

export function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = PATH_TO_TAB[location.pathname] ?? "dashboard"

  const handleNewProject = () => {
    if (
      location.pathname !== TAB_PATHS.batch &&
      location.pathname !== TAB_PATHS.generator &&
      location.pathname !== TAB_PATHS.cover
    ) {
      navigate(TAB_PATHS.batch)
    }
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kuafa:new-project"))
    }, 50)
  }

  return (
    <NotificationProvider>
      <JobsProvider>
        <MaterialsProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <ToastContainer />
            <AppSidebar />
            <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-background">
              <AppHeader title={TAB_TITLES[activeTab]} onNewProject={handleNewProject} />
              <ActiveJobBanner />
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
                path={TAB_PATHS.bgm}
                element={
                  <BgmView
                    onGoBatch={() => navigate(TAB_PATHS.batch)}
                    onGoGenerator={() => navigate(TAB_PATHS.generator)}
                  />
                }
              />
              <Route
                path={TAB_PATHS.generator}
                element={
                  <GeneratorView
                    onGoLibrary={() => navigate(TAB_PATHS.library)}
                    onGoHistory={() => navigate(TAB_PATHS.history)}
                  />
                }
              />
              <Route
                path={TAB_PATHS.batch}
                element={
                  <BatchView
                    onGoLibrary={() => navigate(TAB_PATHS.library)}
                  />
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
      </JobsProvider>
    </NotificationProvider>
  )
}

export default App
