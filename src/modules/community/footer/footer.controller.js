import { footerModel } from './footer.model.js';

export async function getFooter(req, res, next) {
  try {
    const data = await footerModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
