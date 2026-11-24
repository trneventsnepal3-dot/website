import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/koulen/latin-400.css'
import '@fontsource-variable/work-sans'
import App from './App'
import { lazy, Suspense } from 'react'
import { startAnalytics } from './analytics'
import './styles.css'
const Admin = lazy(() => import('./admin/Admin'))

const admin = window.location.pathname.replace(/\/$/, '') === '/admin'
if (!admin) startAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{admin ? <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}><Admin /></Suspense> : <App />}</React.StrictMode>)
