import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

// The data-router context enables customer forms to block dirty navigation.
// App retains the existing route tree and all Phase 1 session guards.
const router = createBrowserRouter([{ path: '*', element: <App /> }])

const root = document.getElementById('root')
if (!root) throw new Error('OptiDesk root element was not found.')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
