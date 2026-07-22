/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: {
          900: '#EEF2F5',
          800: '#FFFFFF',
          700: '#DCE4E9',
          600: '#C7D2D9',
          500: '#A8B9C4'
        },
        gauge: {
          ok: '#0E7A54',
          warn: '#B45309',
          danger: '#BE123C',
          idle: '#64748B'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      }
    },
  },
  plugins: [],
}
