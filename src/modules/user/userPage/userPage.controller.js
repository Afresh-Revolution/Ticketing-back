import { userPageModel } from './userPage.model.js';

export async function getProfile(req, res, next) {
  try {
    const data = await userPageModel.getProfile(req.user.id);
    if (!data) return res.status(404).json({ error: 'User not found' });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getMyTickets(req, res, next) {
  try {
    const data = await userPageModel.getTickets(req.user.id);
    res.json(data);
  } catch (e) {
    next(e);
  }
}
