import { createContext, useContext } from 'react'
import type { SignupFields, User } from '../api'

export interface AuthState {
  user: User | null
  /** False until the first session check finishes. */
  ready: boolean
  logIn: (email: string, password: string) => Promise<void>
  signUp: (fields: SignupFields) => Promise<void>
  logOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
