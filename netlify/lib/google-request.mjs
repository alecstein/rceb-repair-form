import { GoogleAuth } from 'google-auth-library';

let auth;

export async function googleRequest(url, options = {}) {
  if (!auth) {
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_JSON in Netlify.');
    }

    if (!credentials.client_email || !credentials.private_key || credentials.type !== 'service_account') {
      throw new Error('Invalid Google service account configuration.');
    }

    auth = new GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });
  }

  const client = await auth.getClient();

  // Never automatically retry a write whose result may already have committed.
  const response = await client.request({
    url,
    ...options,
    retry: false,
    timeout: 20000
  });

  return response.data;
}
