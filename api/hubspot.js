// Vercel serverless function — proxies HubSpot API so the key stays server-side
// Deploy env var: HUBSPOT_ACCESS_TOKEN = your HubSpot private app token
//
// Endpoints:
//   GET /api/hubspot?action=contacts[&after=cursor]  — paginated contact sync
//   GET /api/hubspot?action=emails&hsId=123          — email engagements for a HubSpot contact ID
//   GET /api/hubspot?action=emails&email=x@y.com     — look up contact by email then fetch emails

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!HS_TOKEN) {
    return res.status(200).json({ results: [], paging: null, _note: 'Set HUBSPOT_ACCESS_TOKEN in Vercel env vars to enable sync' });
  }

  const { action = 'contacts', after, hsId, email } = req.query;

  try {
    // ── Email engagements ──────────────────────────────────────────────────
    if (action === 'emails') {
      let contactHsId = hsId;

      // If no hsId, look up the contact by email address first
      if (!contactHsId && email) {
        const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
            properties: ['email'],
            limit: 1
          })
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          contactHsId = searchData.results?.[0]?.id;
        }
      }

      if (!contactHsId) {
        return res.status(200).json({ emails: [], _note: 'Contact not found in HubSpot' });
      }

      // Get email engagement IDs associated with this contact
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactHsId}/associations/emails?limit=20`,
        { headers: { 'Authorization': `Bearer ${HS_TOKEN}` } }
      );
      if (!assocRes.ok) {
        return res.status(200).json({ emails: [], _note: 'No email associations found' });
      }
      const assocData = await assocRes.json();
      const emailIds = (assocData.results || []).map(r => r.id).slice(0, 20);

      if (!emailIds.length) {
        return res.status(200).json({ emails: [] });
      }

      // Batch-read the email objects
      const batchRes = await fetch('https://api.hubapi.com/crm/v3/objects/emails/batch/read', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: emailIds.map(id => ({ id })),
          properties: ['hs_email_subject', 'hs_email_direction', 'hs_email_status',
                        'hs_email_from_email', 'hs_email_from_firstname', 'hs_email_from_lastname',
                        'hs_email_to_email', 'hs_timestamp', 'hs_email_text']
        })
      });

      if (!batchRes.ok) {
        return res.status(200).json({ emails: [], _note: 'Could not read email details' });
      }

      const batchData = await batchRes.json();
      const emails = (batchData.results || [])
        .map(e => ({
          id: e.id,
          subject: e.properties.hs_email_subject || '(no subject)',
          direction: e.properties.hs_email_direction, // INCOMING_EMAIL or EMAIL
          status: e.properties.hs_email_status,
          from: [e.properties.hs_email_from_firstname, e.properties.hs_email_from_lastname].filter(Boolean).join(' ') || e.properties.hs_email_from_email || '',
          fromEmail: e.properties.hs_email_from_email || '',
          to: e.properties.hs_email_to_email || '',
          timestamp: e.properties.hs_timestamp,
          snippet: (e.properties.hs_email_text || '').substring(0, 200)
        }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return res.status(200).json({ emails });
    }

    // ── Contact sync (default) ─────────────────────────────────────────────
    // Only pull contacts that have been contacted in the last year
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const body = {
      properties: ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'lifecyclestage', 'phone', 'notes_last_contacted', 'hs_last_sales_activity_timestamp'],
      limit: 200,
      sorts: [{ propertyName: 'notes_last_contacted', direction: 'DESCENDING' }],
      filterGroups: [{
        filters: [{
          propertyName: 'notes_last_contacted',
          operator: 'GTE',
          value: String(oneYearAgo)
        }]
      }]
    };
    if (after) body.after = after;

    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HS_TOKEN}`, 'Content-Type': 'application/json' },
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
