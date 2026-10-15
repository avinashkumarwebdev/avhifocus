/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#244B38',
        forestdeep: '#1B3A2B',
        cream: '#F4EBDD',
        creamdark: '#E9DCC8',
        terra: '#D77A4A',
        terradeep: '#B85F33',
        wood: '#8B6345',
        sage: '#A7B99A',
        sagedeep: '#7C9370',
        ink: '#292D27',
        inksoft: '#5A6156'
      },
      fontFamily: {
        rounded: [
          'ui-rounded', '"SF Pro Rounded"', '"Hiragino Maru Gothic ProN"',
          'Quicksand', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'
        ]
      },
      boxShadow: {
        card: '0 1px 0 rgba(41,45,39,0.04), 0 8px 24px -12px rgba(36,75,56,0.25)',
        pop: '0 12px 40px -12px rgba(36,75,56,0.35)'
      },
      borderRadius: { xl2: '1.25rem' }
    }
  },
  plugins: []
}
