import { Buffer } from 'node:buffer';

function makeDebugId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    .slice(-8)
    .toUpperCase();
}

const json = (value, status = 200, debugId = '') =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(debugId ? { 'x-debug-id': debugId } : {})
    }
  });

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Follow redirects explicitly so each network leg has its own timing.
// Log only hostnames: redirect query strings contain one-time response tokens.
export async function fetchWithTiming(url, options, debugId) {
  const startedAt = Date.now();
  let target = new URL(url);
  let init = { ...options, redirect: 'manual' };
  for (let hop = 0; hop <= 20; hop++) {
    const hopStartedAt = Date.now();
    console.log(`[${debugId}] upstream hop started`, {
      hop, host: target.hostname, method: init.method || 'GET'
    });
    const response = await fetch(target, init);
    console.log(`[${debugId}] upstream headers received`, {
      hop, host: target.hostname, status: response.status,
      hopMs: Date.now() - hopStartedAt, totalMs: Date.now() - startedAt
    });
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return response;
    }
    const next = new URL(location, target);
    // Match fetch's POST-to-GET redirect behavior; never retry the POST.
    if (([301, 302].includes(response.status) && init.method === 'POST') ||
        (response.status === 303 && init.method !== 'HEAD')) {
      init = { ...init, method: 'GET', body: undefined };
      const headers = new Headers(init.headers);
      headers.delete('content-type');
      headers.delete('content-length');
      init.headers = headers;
    }
    if (next.origin !== target.origin) {
      const headers = new Headers(init.headers);
      for (const name of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(name);
      init.headers = headers;
    }
    await response.body?.cancel();
    target = next;
  }
  throw codedError('UPSTREAM_REDIRECT_LIMIT', 'Too many upstream redirects.');
}

async function readAppsScriptResponse(response, debugId) {
  const bodyStartedAt = Date.now();
  const text = await response.text();
  console.log(`[${debugId}] upstream body received`, { bodyMs: Date.now() - bodyStartedAt, characters: text.length });
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error(`[${debugId}] Apps Script returned non-JSON`, {
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyCharacters: text.length
    });

    throw codedError(
      'APPSCRIPT_BAD_RESPONSE',
      `Apps Script returned an invalid response (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw codedError(
      `APPSCRIPT_HTTP_${response.status}`,
      data.error || `Apps Script returned HTTP ${response.status}.`
    );
  }

  if (!data.ok) {
    throw codedError(
      data.code || 'APPSCRIPT_ERROR',
      data.error || 'Apps Script rejected the submission.'
    );
  }

  return data;
}

export default async request => {
  const startedAt = Date.now();
  let debugId = makeDebugId();

  try {
    const appsScriptUrl = process.env.APPS_SCRIPT_URL;

    if (!appsScriptUrl) {
      return json(
        {
          ok: false,
          code: 'CONFIG_ERROR',
          debugId,
          error: 'APPS_SCRIPT_URL is not configured in Netlify.'
        },
        500,
        debugId
      );
    }

    const incomingUrl = new URL(request.url);

    if (request.method === 'GET') {
      const action = incomingUrl.searchParams.get('action') || '';

      const target = new URL(appsScriptUrl);

      // Forward the query string verbatim. In addition to legacy autocomplete,
      // this carries action=status&id=... for the post-write verification check.
      for (const [key, value] of incomingUrl.searchParams.entries()) {
        target.searchParams.set(key, value);
      }

      target.searchParams.set('traceId', debugId);
      const submissionId = incomingUrl.searchParams.get('id') || '';
      console.log(`[${debugId}] status correlation`, {
        submissionId: /^[A-Za-z0-9_-]{4,64}$/.test(submissionId) ? submissionId : ''
      });

      console.log(`[${debugId}] GET ${action || '(no action)'} started`);

      let response;
      try {
        response = await fetchWithTiming(target, { cache: 'no-store' }, debugId);
      } catch (error) {
        throw codedError(
          'UPSTREAM_FETCH_ERROR',
          `Could not reach Apps Script: ${error?.message || 'network error'}`
        );
      }

      console.log(
        `[${debugId}] Apps Script GET responded HTTP ${response.status} after ${Date.now() - startedAt}ms`
      );

      const data = await readAppsScriptResponse(response, debugId);

      return json(
        { ...data, debugId },
        200,
        debugId
      );
    }

    if (request.method === 'POST') {
      const incoming = await request.formData();

      const suppliedDebugId = String(incoming.get('debugId') || '').trim();
      if (/^[A-Za-z0-9_-]{4,64}$/.test(suppliedDebugId)) {
        debugId = suppliedDebugId;
      }

      console.log(`[${debugId}] Submission received`);

      const payload = {};
      let fileCount = 0;
      let fileBytes = 0;

      for (const [key, value] of incoming.entries()) {
        if (typeof value === 'string') {
          payload[key] = value;
          continue;
        }

        const bytes = Buffer.from(await value.arrayBuffer());
        fileCount++;
        fileBytes += bytes.length;

        payload[key] = {
          name: value.name || key,
          type: value.type || 'application/octet-stream',
          data: bytes.toString('base64')
        };
      }

      console.log(`[${debugId}] Payload prepared`, {
        fields: Object.keys(payload).length,
        fileCount,
        fileBytes
      });

      let response;

      try {
        console.log(`[${debugId}] Sending submission to Apps Script`);

        response = await fetchWithTiming(appsScriptUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload)
        }, debugId);
      } catch (error) {
        throw codedError(
          'UPSTREAM_FETCH_ERROR',
          `Could not reach Apps Script: ${error?.message || 'network error'}`
        );
      }

      console.log(
        `[${debugId}] Apps Script responded HTTP ${response.status} after ${Date.now() - startedAt}ms`
      );

      const data = await readAppsScriptResponse(response, debugId);

      console.log(
        `[${debugId}] Submission succeeded after ${Date.now() - startedAt}ms`
      );

      return json(
        { ...data, debugId },
        200,
        debugId
      );
    }

    return json(
      {
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        debugId,
        error: 'Method not allowed.'
      },
      405,
      debugId
    );
  } catch (error) {
    const code = error?.code || 'FUNCTION_ERROR';

    console.error(
      `[${debugId}] ${code} after ${Date.now() - startedAt}ms`,
      error
    );

    return json(
      {
        ok: false,
        code,
        debugId,
        error: error?.message || 'Request failed.'
      },
      500,
      debugId
    );
  }
};
