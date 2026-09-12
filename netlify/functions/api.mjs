import { Buffer } from 'node:buffer';

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readAppsScriptResponse(response, debugId) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    console.error(`[${debugId}] Invalid Apps Script response:`, {
      status: response.status,
      body: text.slice(0, 1000)
    });

    throw Object.assign(
      new Error('Apps Script returned an invalid response.'),
      { code: 'APPSCRIPT_BAD_RESPONSE' }
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(data.error || `Apps Script returned HTTP ${response.status}.`),
      { code: `APPSCRIPT_HTTP_${response.status}` }
    );
  }

  if (!data.ok) {
    throw Object.assign(
      new Error(data.error || 'Apps Script rejected the submission.'),
      { code: data.code || 'APPSCRIPT_ERROR' }
    );
  }

  return data;
}

export default async request => {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;

  let debugId =
    Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

  if (!appsScriptUrl) {
    return json({
      ok: false,
      code: 'CONFIG_ERROR',
      debugId,
      error: 'APPS_SCRIPT_URL is not configured.'
    }, 500);
  }

  try {
    const incomingUrl = new URL(request.url);

    if (request.method === 'GET') {
      const action =
        incomingUrl.searchParams.get('action') || '';

      const q =
        incomingUrl.searchParams.get('q') || '';

      const target =
        new URL(appsScriptUrl);

      target.searchParams.set('action', action);
      target.searchParams.set('q', q);

      const response =
        await fetchWithTimeout(
          target,
          {
            redirect: 'follow',
            cache: 'no-store'
          }
        );

      const data =
        await readAppsScriptResponse(
          response,
          debugId
        );

      return json({
        ...data,
        debugId
      });
    }

    if (request.method === 'POST') {
      const incoming =
        await request.formData();

      debugId =
        incoming.get('debugId') ||
        debugId;

      console.log(`[${debugId}] Submission started`);

      const payload = {};

      for (const [key, value] of incoming.entries()) {
        if (typeof value === 'string') {
          payload[key] = value;
          continue;
        }

        const bytes =
          Buffer.from(
            await value.arrayBuffer()
          );

        payload[key] = {
          name: value.name || key,
          type:
            value.type ||
            'application/octet-stream',
          data:
            bytes.toString('base64')
        };
      }

      console.log(`[${debugId}] Sending to Apps Script`);

      const response =
        await fetchWithTimeout(
          appsScriptUrl,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify(payload),
            redirect: 'follow'
          },
          25000
        );

      console.log(
        `[${debugId}] Apps Script responded ${response.status}`
      );

      const data =
        await readAppsScriptResponse(
          response,
          debugId
        );

      console.log(`[${debugId}] Submission successful`);

      return json({
        ...data,
        debugId
      });
    }

    return json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      debugId,
      error: 'Method not allowed.'
    }, 405);

  } catch (error) {
    let code =
      error?.code ||
      'NETLIFY_ERROR';

    if (
      error?.name === 'AbortError'
    ) {
      code =
        'UPSTREAM_TIMEOUT';
    }

    console.error(`[${debugId}] ${code}`, error);

    return json({
      ok: false,
      code,
      debugId,
      error:
        error?.name === 'AbortError'
          ? 'Apps Script did not respond within 25 seconds.'
          : error?.message || 'Request failed.'
    }, 500);
  }
};
