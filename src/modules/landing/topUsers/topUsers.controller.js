import { topUsersModel } from './topUsers.model.js';

export async function getTopUsers(req, res, next) {
  try {
    const list = await topUsersModel.getAll();
    res.json(list);
  } catch (err) {
    next(err);
  }
}
