const config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#080B14',
        panel: '#0F172A',
        ink: '#E2E8F0',
        brand: {
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
        },
        live: {
          300: '#FDA4AF',
          500: '#F43F5E',
        },
        success: {
          300: '#6EE7B7',
          500: '#34D399',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.07)',
        card: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
        'brand-glow': '0 0 28px rgba(99,102,241,0.4)',
        'live-glow': '0 0 28px rgba(244,63,94,0.35)',
        'violet-glow': '0 0 28px rgba(139,92,246,0.35)',
      },
      keyframes: {
        'pulse-live': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(244,63,94,0.6)' },
          '50%': { boxShadow: '0 0 0 6px rgba(244,63,94,0)' },
        },
        'pulse-online': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.6)' },
          '50%': { boxShadow: '0 0 0 6px rgba(34,197,94,0)' },
        },
      },
      animation: {
        'pulse-live': 'pulse-live 1.5s ease-in-out infinite',
        'pulse-online': 'pulse-online 2s ease-in-out infinite',
      },
      backgroundImage: {
        aurora:
          'radial-gradient(ellipse 60% 50% at 15% 10%, rgba(99,102,241,0.18) 0%, transparent 60%), radial-gradient(ellipse 50% 50% at 85% 85%, rgba(14,165,233,0.15) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 50% 50%, rgba(30,41,59,0.55) 0%, transparent 80%)',
      },
    },
  },
  plugins: [],
};

export default config;
