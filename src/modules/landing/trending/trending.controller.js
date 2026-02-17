import { trendingModel } from './trending.model.js';

export async function getTrending(req, res, next) {
  try {
    const data = await trendingModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
