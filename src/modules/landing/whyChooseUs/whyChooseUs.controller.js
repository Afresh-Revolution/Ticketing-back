import { whyChooseUsModel } from './whyChooseUs.model.js';

export async function getWhyChooseUs(req, res, next) {
  try {
    const data = await whyChooseUsModel.get();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
