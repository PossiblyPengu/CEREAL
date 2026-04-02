import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

try {
  const a = localStorage.getItem('cereal-boot-accent') || '#d4a853';
  const bg = localStorage.getItem('cereal-boot-bg') || '#07070d';
  document.documentElement.style.setProperty('--accent', a);
  document.body.style.background = bg;
} catch (_) {}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
