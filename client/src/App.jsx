import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';

const DirectCallPage = lazy(() => import('./pages/DirectCallPage.jsx'));
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const RoomPage = lazy(() => import('./pages/RoomPage.jsx'));

const THEME_STORAGE_KEY = 'ephemeral-chat-theme';

function getInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function handleToggleTheme() {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }

  return (
    <Suspense
      fallback={(
        <main className="landing-page page-shell direct-call-page-shell">
          <section className="card status-card elevated-card">
            <span className="eyebrow">Loading</span>
            <h1>Preparing workspace</h1>
            <p>Loading the next experience...</p>
          </section>
        </main>
      )}
    >
      <Routes>
        <Route
          path="/"
          element={<LandingPage onToggleTheme={handleToggleTheme} theme={theme} />}
        />
        <Route
          path="/direct-call"
          element={<DirectCallPage onToggleTheme={handleToggleTheme} theme={theme} />}
        />
        <Route
          path="/room/:roomId"
          element={<RoomPage onToggleTheme={handleToggleTheme} theme={theme} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
