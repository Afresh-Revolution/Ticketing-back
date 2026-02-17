import { categoriesModel } from './categories.model.js';

export async function getCategories(req, res, next) {
  try {
    const data = await categoriesModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
