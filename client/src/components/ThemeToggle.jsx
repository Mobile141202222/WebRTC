import { MoonIcon, SunIcon } from './Icons.jsx';

function ThemeToggle({ onToggleTheme, theme }) {
  const isDark = theme === 'dark';

  return (
    <button
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="theme-toggle icon-button secondary-button"
      onClick={onToggleTheme}
      title={isDark ? 'Light mode' : 'Dark mode'}
      type="button"
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
      <span className="sr-only">{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}

export default ThemeToggle;
