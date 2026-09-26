const config = {
  content: { relative: true, files: ['./src/**/*.{js,ts,jsx,tsx,mdx}'] },
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-canvas)', panel: 'var(--color-surface)', ink: 'var(--color-text)',
        muted: 'var(--color-muted)', line: 'var(--color-line)',
        brand: { 50: '#EDF3F5', 100: '#DCE9ED', 300: '#668A96', 400: '#4C7482', 500: '#355F6D', 600: '#294D59', 700: '#203E48' },
        live: { 300: '#9F4255', 500: '#B5465E' },
        success: { 300: '#386D54', 500: '#386D54' },
      },
      fontFamily: { sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
export default config;
