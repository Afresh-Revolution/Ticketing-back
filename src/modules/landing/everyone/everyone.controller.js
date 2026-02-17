import { everyoneModel } from './everyone.model.js';

export async function getEveryone(req, res, next) {
  try {
    const data = await everyoneModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
