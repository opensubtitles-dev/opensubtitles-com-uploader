/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
  // Keep `dark:` utilities working alongside DaisyUI's `data-theme` so the
  // existing inline-style components don't break before the daisyui rewrite.
  darkMode: ['class', '[data-theme="osub-dark"]'],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        'osub-light': {
          primary: '#0ea5e9',
          'primary-content': '#ffffff',
          secondary: '#14b8a6',
          accent: '#f59e0b',
          neutral: '#1f2937',
          'base-100': '#ffffff',
          'base-200': '#f3f4f6',
          'base-300': '#e5e7eb',
          'base-content': '#111827',
          info: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '0.5rem',
        },
      },
      {
        'osub-dark': {
          primary: '#38bdf8',
          'primary-content': '#0c1018',
          secondary: '#2dd4bf',
          accent: '#fbbf24',
          neutral: '#111827',
          'base-100': '#0f172a',
          'base-200': '#1e293b',
          'base-300': '#334155',
          'base-content': '#e5e7eb',
          info: '#60a5fa',
          success: '#34d399',
          warning: '#fbbf24',
          error: '#f87171',
          '--rounded-box': '0.75rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '0.5rem',
        },
      },
    ],
    darkTheme: 'osub-dark',
    base: true,
    styled: true,
    utils: true,
    logs: false,
  },
};
