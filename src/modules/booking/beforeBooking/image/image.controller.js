import { imageModel } from './image.model.js';

export async function getImage(req, res, next) {
  try {
    const data = await imageModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
