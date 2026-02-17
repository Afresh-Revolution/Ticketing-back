import { heroModel } from './hero.model.js';

export async function getHero(req, res, next) {
  try {
    const data = await heroModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
