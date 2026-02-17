import { artModel } from './art.model.js';

export async function getArt(req, res, next) {
  try {
    const data = await artModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
