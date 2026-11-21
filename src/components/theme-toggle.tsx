"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";
  return <button
    type="button"
    aria-label={`Switch to ${nextTheme} mode`}
    aria-pressed={theme === "dark"}
    title={`Switch to ${nextTheme} mode`}
    onClick={toggleTheme}
    className="theme-toggle"
  >
    {theme === "dark" ? <Sun size={18} aria-hidden/> : <Moon size={18} aria-hidden/>}
    <span className="sr-only">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
  </button>;
}
