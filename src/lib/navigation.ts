import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  CreditCard,
  FileText,
  LayoutDashboard,
  Settings,
  ShoppingBag,
  Users,
} from 'lucide-react'

export type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
  end?: boolean
}

export const primaryNavigation: NavigationItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, end: true },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Sales & Purchases', to: '/purchases', icon: ShoppingBag },
  { label: 'Prescriptions', to: '/prescriptions', icon: FileText },
  { label: 'Payments', to: '/payments', icon: CreditCard },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
]

export const utilityNavigation: NavigationItem[] = [
  { label: 'Settings', to: '/settings', icon: Settings },
]

