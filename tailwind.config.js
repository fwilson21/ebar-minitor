/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: {
          900: '#0B1521',
          800: '#10202F',
          700: '#16303F',
          600: '#1E4254'
        },
        gauge: {
          ok: '#2DD4BF',
          warn: '#F5A524',
          danger: '#F2495C',
          idle: '#5B7184'
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
