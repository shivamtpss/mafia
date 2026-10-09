import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cinematic dark palette (section 8).
        midnight: {
          950: '#05060d',
          900: '#0a0b17',
          800: '#11131f',
          700: '#181b2b',
        },
        charcoal: {
          900: '#13141c',
          800: '#1b1d28',
          700: '#242736',
          600: '#2f3245',
        },
        crimson: {
          DEFAULT: '#b2243a',
          muted: '#8a2030',
          glow: '#e23b55',
        },
        violet: {
          electric: '#7c5cff',
          glow: '#9b7bff',
        },
        cool: {
          blue: '#38bdf8',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(124, 92, 255, 0.5)',
        'glow-crimson': '0 0 40px -10px rgba(226, 59, 85, 0.5)',
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 6s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
