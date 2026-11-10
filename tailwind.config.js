/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: {
          base: '#090d16',
          surface: '#0f172a',
          card: '#151e32',
          cardActive: '#1c2842',
          border: '#23324d',
          borderSubtle: '#1b273d',
          accent: '#3b82f6',
          accentHover: '#2563eb',
          textMuted: '#94a3b8',
          rowHover: '#172238',
          selected: '#1e335a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
      }
    }
  },
  plugins: [],
}
