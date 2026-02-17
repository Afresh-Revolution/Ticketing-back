import { gatewaveModel } from './gatewave.model.js';

export async function getGatewave(req, res, next) {
  try {
    const user = req.user ?? null;
    const data = await gatewaveModel.get(user);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
