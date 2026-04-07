/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Oswald"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        hero: ['clamp(2.75rem, 6vw, 4.5rem)', { lineHeight: '0.95', letterSpacing: '-0.02em' }],
        display: ['clamp(2rem, 4vw, 2.75rem)', { lineHeight: '1', letterSpacing: '-0.01em' }],
      },
      colors: {
        // Theme-aware: consumed from CSS custom properties so both dark/light work
        // and Tailwind's <alpha-value> modifier still functions (e.g. `bg-accent/20`).
        'bg-deep': 'rgb(var(--bg-deep-rgb) / <alpha-value>)',
        'bg-surface': 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        ink: 'rgb(var(--bg-deep-rgb) / <alpha-value>)',
        panel: 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
        'border-subtle': 'var(--border-subtle)',
        'border-focus': 'var(--border-focus)',
        'text-primary': 'rgb(var(--text-primary-rgb) / <alpha-value>)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: '#22d3ee',
          dim: '#164e63',
        },
        gold: {
          DEFAULT: 'rgb(var(--gold-rgb) / <alpha-value>)',
          dim: '#78350f',
        },
        // Position colors are static — same contrast works in both themes.
        pos: {
          qb: '#ef4444',
          rb: '#22d3ee',
          wr: '#3b82f6',
          te: '#f472b6',
          ot: '#eab308',
          iol: '#ca8a04',
          edge: '#f97316',
          dt: '#a78bfa',
          cb: '#a3e635',
          s: '#34d399',
          lb: '#2dd4bf',
        },
      },
      boxShadow: {
        card: 'var(--card-shadow)',
        glass: 'var(--card-shadow)',
        glow: '0 0 0 1px rgb(var(--accent-rgb) / 0.45), 0 0 40px -8px rgb(var(--accent-rgb) / 0.55)',
        'glow-gold': '0 0 0 1px rgb(var(--gold-rgb) / 0.35), 0 0 32px -8px rgb(var(--gold-rgb) / 0.45)',
      },
      backgroundImage: {
        'gradient-accent': 'var(--gradient-accent)',
        'gradient-gold': 'var(--gradient-gold)',
        'gradient-card': 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, transparent 100%)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: 0, transform: 'translateX(10px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        slideInLeft: {
          from: { opacity: 0, transform: 'translateX(-10px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        flash: {
          '0%': { boxShadow: '0 0 0 0 rgba(0,229,255,0.7)' },
          '70%': { boxShadow: '0 0 0 10px rgba(0,229,255,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(0,229,255,0)' },
        },
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 0 1px rgba(0,229,255,0.45), 0 0 28px -8px rgba(0,229,255,0.5)' },
          '50%': { boxShadow: '0 0 0 1px rgba(0,229,255,0.6), 0 0 48px -6px rgba(0,229,255,0.75)' },
        },
        popIn: {
          '0%': { opacity: 0, transform: 'scale(0.7)' },
          '60%': { opacity: 1, transform: 'scale(1.08)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 220ms ease-out both',
        'slide-in-r': 'slideInRight 220ms ease-out both',
        'slide-in-l': 'slideInLeft 220ms ease-out both',
        flash: 'flash 700ms ease-out 1',
        'pulse-glow': 'pulseGlow 2600ms ease-in-out infinite',
        'pop-in': 'popIn 260ms cubic-bezier(0.22, 1.2, 0.36, 1) both',
        shimmer: 'shimmer 1600ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
