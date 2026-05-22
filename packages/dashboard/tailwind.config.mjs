/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        kiwoom: {
          DEFAULT: '#e11d48',  // accent for our client
          50: '#fff1f2',
        },
      },
    },
  },
  plugins: [],
};
