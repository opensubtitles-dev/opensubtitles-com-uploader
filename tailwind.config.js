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
        // Match opensubtitles.com Nexus light: white cards, neutral zinc surrounds
        'osub-light': {
          primary: '#0ea5e9',
          'primary-content': '#ffffff',
          secondary: '#14b8a6',
          accent: '#f59e0b',
          neutral: '#18181b',
          'base-100': '#ffffff',
          'base-200': '#fafafa',
          'base-300': '#e4e4e7',
          'base-content': '#18181b',
          info: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          '--rounded-box': '0.5rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '0.375rem',
        },
      },
      {
        // Match opensubtitles.com Nexus dark: near-black page, zinc-900 cards,
        // no blue tint (was slate-900/800 before — too blueish per the .com palette)
        'osub-dark': {
          primary: '#38bdf8',
          'primary-content': '#0a0a0a',
          secondary: '#2dd4bf',
          accent: '#fbbf24',
          neutral: '#27272a',
          'base-100': '#18181b',
          'base-200': '#0a0a0a',
          'base-300': '#27272a',
          'base-content': '#e4e4e7',
          info: '#60a5fa',
          success: '#34d399',
          warning: '#fbbf24',
          error: '#f87171',
          '--rounded-box': '0.5rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '0.375rem',
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
