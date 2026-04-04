import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import LandingPage from './pages/LandingPage.jsx';
import RoomPage from './pages/RoomPage.jsx';

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
    <Routes>
      <Route
        path="/"
        element={<LandingPage onToggleTheme={handleToggleTheme} theme={theme} />}
      />
      <Route
        path="/room/:roomId"
        element={<RoomPage onToggleTheme={handleToggleTheme} theme={theme} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

