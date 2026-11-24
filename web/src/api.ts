import { initData } from './telegram';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const auth = (): Record<string, string> => (initData ? { Authorization: `tma ${initData}` } : {});

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your internet and try again.');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await send(path, {
    method,
    headers: {
      ...auth(),
      // A FormData body sets its own multipart boundary.
      ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? 'error', data?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

/** A private file the app may show (the creator's own story copy): fetched with the launch data, shown as a blob. */
async function blobUrl(path: string): Promise<string | null> {
  const response = await send(path, { headers: auth() });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

export const api = {
  blobUrl,
  form: <T>(path: string, data: FormData) => request<T>('POST', path, data),
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
