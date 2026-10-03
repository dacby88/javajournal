import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User } from '@/types';
import { auth, type AuthStatus } from '@/services/auth';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setup: (username: string, password: string, setupToken: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  checkAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const checkAuthStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const status: AuthStatus = await auth.checkStatus();
      setNeedsSetup(status.needs_setup);
      setIsAuthenticated(status.authenticated);
      setUser(status.user);
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setNeedsSetup(false);
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await auth.login(username, password);
    if (response.success && response.user) {
      setUser(response.user);
      setIsAuthenticated(true);
      setNeedsSetup(false);
    } else {
      throw new Error(response.message || 'Login failed');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      // Check status again in case setup is needed
      await checkAuthStatus();
    }
  }, [checkAuthStatus]);

  const setup = useCallback(async (username: string, password: string, setupToken: string) => {
    const response = await auth.setup(username, password, setupToken);
    if (response.success && response.user) {
      setUser(response.user);
      setIsAuthenticated(true);
      setNeedsSetup(false);
    } else {
      throw new Error(response.message || 'Setup failed');
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const response = await auth.changePassword(currentPassword, newPassword);
    if (!response.success) {
      throw new Error(response.message || 'Failed to change password');
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        needsSetup,
        login,
        logout,
        setup,
        changePassword,
        checkAuthStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
