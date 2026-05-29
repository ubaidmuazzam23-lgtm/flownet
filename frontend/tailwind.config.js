// frontend/tailwind.config.js
/** Tailwind config — FlowNet AI theme */
/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
      extend: {
        colors: {
          ink:    { 950: '#0E0C0F', 900: '#161316', 850: '#1A171B', 800: '#1E1B1F', 700: '#221F24', 600: '#2A262C', 500: '#34303A' },
          line:   { DEFAULT: '#2B262E', strong: '#3A343F' },
          ash:    { 100: '#F5F2F7', 200: '#D6D2DC', 300: '#A8A2B0', 400: '#8C8694', 500: '#6C6772', 600: '#4E4A55' },
          flame:  { 300: '#FFB28A', 400: '#FF8E54', 500: '#FF6D29', 600: '#E2530F', 700: '#B23F08' },
          cobalt: { 300: '#7BB4FF', 400: '#3B92FF', 500: '#1677FF', 600: '#0B5BD3', 700: '#0846A0' },
          orchid: { 300: '#B68CF0', 400: '#925CE6', 500: '#722ED1', 600: '#591FA8', 700: '#411680' },
          jade:   { 300: '#9FE26A', 400: '#76D434', 500: '#52C41A', 600: '#3E9613', 700: '#2B6B0D' },
          amber:  { 400: '#FFC542', 500: '#F5A623' },
          danger: { 500: '#FF4D4F', 600: '#D9363E' },
        },
        fontFamily: {
          display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
          sans:    ['Inter', 'system-ui', 'sans-serif'],
          mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        },
      },
    },
    plugins: [],
  };