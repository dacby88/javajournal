import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ExecutionsPage } from './components/ExecutionsPage.tsx'
import { TradesPage } from './components/TradesPage.tsx'
import { TradeDetailPage } from './components/TradeDetailPage.tsx'
import { TestPage } from './components/TestPage.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { ProtectedRoute } from './components/auth/ProtectedRoute.tsx'

// Initialize theme from localStorage on app load
const initTheme = () => {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme && ['java', 'dark', 'earth', 'terminal', 'tokyo'].includes(savedTheme)) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    document.documentElement.setAttribute('data-theme', 'java');
  }
};

// Run theme initialization immediately
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          
          {/* Protected routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <App />
            </ProtectedRoute>
          } />
          <Route path="/test" element={
            <ProtectedRoute>
              <TestPage />
            </ProtectedRoute>
          } />
          <Route path="/trades" element={
            <ProtectedRoute>
              <TradesPage />
            </ProtectedRoute>
          } />
          <Route path="/trades/:tradeId" element={
            <ProtectedRoute>
              <TradeDetailPage />
            </ProtectedRoute>
          } />
          <Route path="/executions" element={
            <ProtectedRoute>
              <ExecutionsPage />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          } />
          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
