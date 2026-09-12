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

async function readAppsScriptResponse(response, debugId) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error(`[${debugId}] Apps Script returned non-JSON`, {
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyPreview: text.slice(0, 500)
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
      const q = incomingUrl.searchParams.get('q') || '';

      const target = new URL(appsScriptUrl);
      target.searchParams.set('action', action);
      target.searchParams.set('q', q);

      console.log(`[${debugId}] GET ${action || '(no action)'} started`);

      let response;
      try {
        response = await fetch(target, {
          redirect: 'manual',
          cache: 'no-store'
        });
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

        response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload),
          redirect: 'follow'
        });
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
