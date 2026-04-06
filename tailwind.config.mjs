/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.html",
  ],
  theme: {
    extend: {
      colors: {
        'bg-dark': '#121212',
        'surface': '#1e1e1e',
        'surface-hover': '#252525',
        'card-bg': '#2a2a2a',
        'accent': '#2196f3',
        'accent-hover': '#1976d2',
        'text-main': '#eeeeee',
        'text-muted': '#aaaaaa',
        'border-main': '#333333',
        'danger': '#ef5350',
        'success': '#4caf50',
        'warning': '#ff9800',
      },
      boxShadow: {
        'main': '0 4px 12px rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        'glass': 'rgba(255, 255, 255, 0.05)',
      }
    },
  },
  plugins: [],
}
