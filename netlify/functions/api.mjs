import { Buffer } from 'node:buffer';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

async function readAppsScriptResponse(response) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Apps Script returned an unexpected response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error || `Apps Script returned ${response.status}.`
    );
  }

  return data;
}

export default async (request) => {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;

  if (!appsScriptUrl) {
    return json({
      ok: false,
      error: 'APPS_SCRIPT_URL is not configured in Netlify.'
    }, 500);
  }

  try {
    const incomingUrl = new URL(request.url);

    if (request.method === 'GET') {
      const action = incomingUrl.searchParams.get('action') || '';
      const q = incomingUrl.searchParams.get('q') || '';

      const target = new URL(appsScriptUrl);
      target.searchParams.set('action', action);
      target.searchParams.set('q', q);

      const response = await fetch(target, {
        redirect: 'follow',
        cache: 'no-store'
      });

      const data = await readAppsScriptResponse(response);

      return json(data, data.ok ? 200 : 400);
    }

    if (request.method === 'POST') {
      const incoming = await request.formData();
      const payload = {};

      for (const [key, value] of incoming.entries()) {
        if (typeof value === 'string') {
          payload[key] = value;
          continue;
        }

        const bytes = Buffer.from(
          await value.arrayBuffer()
        );

        payload[key] = {
          name: value.name || key,
          type: value.type || 'application/octet-stream',
          data: bytes.toString('base64')
        };
      }

      const response = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });

      const data = await readAppsScriptResponse(response);

      return json(data, data.ok ? 200 : 400);
    }

    return json({
      ok: false,
      error: 'Method not allowed.'
    }, 405);

  } catch (error) {
    console.error(error);

    return json({
      ok: false,
      error: error && error.message
        ? error.message
        : 'Request failed.'
    }, 500);
  }
};
