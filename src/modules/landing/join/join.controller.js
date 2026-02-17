import { joinModel } from './join.model.js';

export async function getJoin(req, res, next) {
  try {
    const data = await joinModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
