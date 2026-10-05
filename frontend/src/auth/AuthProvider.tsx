import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../api'
import { AuthContext, type AuthState } from './useAuth'

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api
      .fetchSession()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      logIn: async (email, password) => setUser(await api.logIn(email, password)),
      signUp: async (fields) => setUser(await api.signUp(fields)),
      logOut: async () => {
        try {
          await api.logOut()
        } finally {
          setUser(null)
        }
      },
    }),
    [user, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
