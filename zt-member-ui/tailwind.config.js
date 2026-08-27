/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sysblue: '#007AFF',
        sysgreen: '#34C759',
        sysorange: '#FF9500',
        sysgray: '#8E8E93',
        grouped: '#F2F2F7',
        separator: '#E5E5EA',
        card: '#FFFFFF',
        hair: 'rgba(60,60,67,0.15)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'PingFang SC', 'sans-serif'],
      },
      borderRadius: {
        xl2: '16px',
      },
    },
  },
  plugins: [],
}
