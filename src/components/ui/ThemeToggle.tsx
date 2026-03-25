import { Moon, Sun } from "lucide-react";
import { useUI } from "../../contexts/UIContext";

export function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useUI();

  return (
    <button
      className="icon-btn"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title="Toggle theme"
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
