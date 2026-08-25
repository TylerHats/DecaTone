import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PhoneProvider } from './context/PhoneContext';
import { BrandingProvider } from './context/BrandingContext';

import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CallModal } from './components/CallModal';

import { HomePage } from './pages/HomePage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { PhoneSettingsPage } from './pages/PhoneSettingsPage';
import { FriendsPage } from './pages/FriendsPage';
import { VoicemailPage } from './pages/VoicemailPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { SetupWizardPage } from './pages/SetupWizardPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode; requireAdmin?: boolean }> = ({ children, requireAdmin }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-muted)' }}>Loading DecaTone...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppContent: React.FC = () => {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/setup/status')
      .then(res => res.json())
      .then(data => {
        setSetupRequired(data.setupRequired);
        if (data.setupRequired && location.pathname !== '/setup') {
          navigate('/setup');
        }
      })
      .catch(() => setSetupRequired(false));
  }, [location.pathname, navigate]);

  if (setupRequired === null) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-muted)' }}>Connecting to switchboard...</div>;
  }

  return (
    <div className="app-container">
      <Navbar />
      <CallModal />
      <main className="main-content">
        <Routes>
          <Route path="/setup" element={<SetupWizardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <PhoneSettingsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/friends"
            element={
              <ProtectedRoute>
                <FriendsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/voicemail"
            element={
              <ProtectedRoute>
                <VoicemailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrandingProvider>
      <AuthProvider>
        <PhoneProvider>
          <AppContent />
        </PhoneProvider>
      </AuthProvider>
    </BrandingProvider>
  );
};

export default App;
