// Talking to /api/admin. The session lives in an HttpOnly cookie the page never sees.
// Every change carries the X-Requested-With header the server requires (a page on another
// site cannot send it) and a JSON or multipart body.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const CSRF = { 'X-Requested-With': 'creators-hub-admin' };

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : form ? CSRF : { ...CSRF, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : (form ?? JSON.stringify(body ?? {})),
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection.');
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, data?.error ?? 'error', data?.message ?? '');
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path, {}),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, undefined, form);
  },
};

/** A query string from the set values only. */
export function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}
