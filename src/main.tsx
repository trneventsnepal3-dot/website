import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/koulen/latin-400.css'
import '@fontsource-variable/work-sans'
import App from './App'
import { lazy, Suspense } from 'react'
import './styles.css'
const Admin = lazy(() => import('./admin/Admin'))

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname.replace(/\/$/, '') === '/admin' ? <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}><Admin /></Suspense> : <App />}</React.StrictMode>)
