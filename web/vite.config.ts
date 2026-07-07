import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// В продакшне (GitHub Pages) приложение живёт по пути /pozdravlyator/,
// в dev — по корню.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/pozdravlyator/' : '/',
  plugins: [react()],
}))
