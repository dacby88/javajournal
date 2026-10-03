import type { User } from '@/types';

import { apiFetch } from './http';

const API_BASE_URL = '/api';

export interface AuthStatus {
  needs_setup: boolean;
  authenticated: boolean;
  user: User | null;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  user?: User;
}

class AuthService {
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await apiFetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Check authentication status
   * Returns {needs_setup, authenticated, user}
   */
  async checkStatus(): Promise<AuthStatus> {
    return this.fetch('/auth/status');
  }

  /**
   * One-time setup for initial user registration
   */
  async setup(username: string, password: string, setupToken: string): Promise<AuthResponse> {
    return this.fetch('/auth/setup', {
      method: 'POST',
      headers: { 'X-Setup-Token': setupToken },
      body: JSON.stringify({ username, password }),
    });
  }

  /**
   * Login with username and password
   */
  async login(username: string, password: string): Promise<AuthResponse> {
    return this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  /**
   * Logout current user
   */
  async logout(): Promise<{ success: boolean; message?: string }> {
    return this.fetch('/auth/logout', {
      method: 'POST',
    });
  }

  /**
   * Change password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
    return this.fetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }
}

export const auth = new AuthService();
export default auth;
