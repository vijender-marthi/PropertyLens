import { useState, useEffect, createContext, useContext } from 'react'

// Colour themes (independent of light/dark). Default is "aqua".
export const COLOR_THEMES = ['aqua', 'glass', 'rose', 'green']

const ThemeContext = createContext({
  dark: false,
  toggle: () => {},
  colorTheme: 'aqua',
  setColorTheme: () => {},
  colorBlind: false,
  setColorBlind: () => {},
})

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('pl-theme')
    if (saved !== null) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const [colorTheme, setColorThemeState] = useState(() => {
    const saved = localStorage.getItem('pl-color-theme')
    return COLOR_THEMES.includes(saved) ? saved : 'aqua'
  })

  const [colorBlind, setColorBlindState] = useState(() => localStorage.getItem('pl-colorblind') === '1')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pl-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', colorTheme)
    localStorage.setItem('pl-color-theme', colorTheme)
  }, [colorTheme])

  useEffect(() => {
    if (colorBlind) document.documentElement.setAttribute('data-cb', '1')
    else document.documentElement.removeAttribute('data-cb')
    localStorage.setItem('pl-colorblind', colorBlind ? '1' : '0')
  }, [colorBlind])

  const setColorTheme = (theme) => setColorThemeState(COLOR_THEMES.includes(theme) ? theme : 'aqua')
  const setColorBlind = (on) => setColorBlindState(Boolean(on))

  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d), colorTheme, setColorTheme, colorBlind, setColorBlind }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
