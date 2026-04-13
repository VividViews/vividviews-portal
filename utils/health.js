const db = require('./db');

async function calculateHealthScore(clientId) {
  let score = 100;

  // Open tickets penalty: each open ticket -5 points
  try {
    const openTickets = await db.get(
      "SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status != 'complete'",
      [clientId]
    );
    score -= (parseInt(openTickets.count) || 0) * 5;
  } catch (e) { /* ignore */ }

  // Avg response time
  try {
    const avgResponse = await db.get(
      db.type === 'pg'
        ? "SELECT AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600) as avg_hours FROM service_requests WHERE client_id = $1 AND first_response_at IS NOT NULL"
        : "SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 24) as avg_hours FROM service_requests WHERE client_id = $1 AND first_response_at IS NOT NULL",
      [clientId]
    );
    const avgHours = parseFloat(avgResponse.avg_hours) || 0;
    if (avgHours > 0) {
      if (avgHours < 24) score += 20;
      else if (avgHours < 48) score += 10;
      else if (avgHours > 72) score -= 10;
    }
  } catch (e) { /* ignore */ }

  // Satisfaction rating average
  try {
    const ratings = await db.get(
      "SELECT AVG(rr.rating) as avg_rating FROM request_ratings rr JOIN service_requests sr ON rr.service_request_id = sr.id WHERE sr.client_id = $1",
      [clientId]
    );
    const avgRating = parseFloat(ratings.avg_rating) || 0;
    if (avgRating >= 5) score += 20;
    else if (avgRating >= 4) score += 10;
    else if (avgRating > 0 && avgRating < 3) score -= 20;
  } catch (e) { /* ignore */ }

  // Recent activity bonus
  try {
    const recent = await db.get(
      db.type === 'pg'
        ? "SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND created_at >= NOW() - INTERVAL '30 days'"
        : "SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND created_at >= datetime('now', '-30 days')",
      [clientId]
    );
    if (parseInt(recent.count) > 0) score += 10;
  } catch (e) { /* ignore */ }

  return Math.max(0, Math.min(100, score));
}

module.exports = { calculateHealthScore };
