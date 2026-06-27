// Vercel serverless function — proxies HubSpot API so the key stays server-side
// Deploy env var: HUBSPOT_ACCESS_TOKEN = your HubSpot private app token

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!HS_TOKEN) {
    // Return empty gracefully — app still works, just no auto-sync
    return res.status(200).json({ results: [], paging: null, _note: 'Set HUBSPOT_ACCESS_TOKEN in Vercel env vars to enable sync' });
  }

  const { after } = req.query;

  try {
    const body = {
      properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'lifecyclestage', 'phone'],
      limit: 200,
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }]
    };
    if (after) body.after = after;

    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `HubSpot error ${response.status}`, detail: text, results: [] });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message, results: [] });
  }
}
