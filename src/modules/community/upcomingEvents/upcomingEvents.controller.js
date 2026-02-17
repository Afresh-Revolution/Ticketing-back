import { upcomingEventsModel } from './upcomingEvents.model.js';

export async function getUpcomingEvents(req, res, next) {
  try {
    const { category, limit } = req.query;
    const data = await upcomingEventsModel.get({
      ...(category && { category: String(category) }),
      ...(limit && { limit: Math.min(parseInt(limit, 10) || 10, 50) }),
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}
