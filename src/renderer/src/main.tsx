import '@fontsource-variable/bricolage-grotesque/wght.css'
import './assets/main.css'
import './components/convertir/convertir.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
