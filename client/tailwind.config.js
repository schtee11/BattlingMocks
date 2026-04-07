/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0a0f1e',
        panel: '#111827',
        surface: '#0f1626',
        border: 'rgba(255,255,255,0.06)',
        accent: {
          DEFAULT: '#22d3ee',
          hover: '#06b6d4',
          dim: '#164e63',
        },
        gold: '#f59e0b',
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(34,211,238,0.35), 0 0 32px -8px rgba(34,211,238,0.4)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: 0, transform: 'translateX(-8px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        countUp: {
          from: { opacity: 0.3 },
          to: { opacity: 1 },
        },
      },
      animation: {
        'fade-in': 'fadeIn 220ms ease-out both',
        'slide-in': 'slideIn 260ms ease-out both',
        'count-up': 'countUp 600ms ease-out both',
      },
    },
  },
  plugins: [],
};
