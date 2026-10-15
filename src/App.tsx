import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Spinner } from './components/ui'
import { Toasts } from './components/Toasts'
import { useAppStore } from './stores/app'

const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const DetailsPage = lazy(() => import('./pages/DetailsPage'))
const HallPage = lazy(() => import('./pages/HallPage'))
const ClassroomPage = lazy(() => import('./pages/ClassroomPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export default function App() {
  const setInstallPrompt = useAppStore((s) => s.setInstallPrompt)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as never)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    // Native app (installed APK): register FCM + local-notification channels.
    void import('./lib/nativePush').then((m) => m.initNativePush())
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [setInstallPrompt])

  return (
    <BrowserRouter>
      <Toasts />
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center bg-cream">
            <Spinner label="Opening AVHIFocus…" />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/details" element={<DetailsPage />} />
          <Route path="/hall" element={<HallPage />} />
          <Route path="/room/:roomId" element={<ClassroomPage />} />
          <Route path="/room/:roomId/board" element={<LeaderboardPage />} />
          <Route path="/room/:roomId/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
