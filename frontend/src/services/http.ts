let csrfRequest: Promise<string> | undefined;

async function csrfToken(): Promise<string> {
  csrfRequest ??= fetch('/api/auth/csrf', { credentials: 'include' })
    .then(async response => {
      if (!response.ok) throw new Error('Could not establish a secure session.');
      return (await response.json()).csrf_token as string;
    })
    .finally(() => { csrfRequest = undefined; });
  return csrfRequest;
}

export async function apiFetch(input: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', await csrfToken());
  }
  const response = await fetch(input, { ...options, credentials: 'include', headers });
  if (response.status === 401 && !input.startsWith('/api/auth/') && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
  return response;
}
