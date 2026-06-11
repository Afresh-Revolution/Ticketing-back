import { streamModel } from './stream.model.js';

export async function listStreamEvents(req, res, next) {
  try {
    const events = await streamModel.listStreamableEvents(req.user?.id);
    res.json(events);
  } catch (e) {
    next(e);
  }
}

export async function getStreamEvent(req, res, next) {
  try {
    const event = await streamModel.getStreamEvent(req.params.eventId, req.user?.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function updateStreamConfig(req, res, next) {
  try {
    const { streamUrl, streamProvider } = req.body || {};
    const event = await streamModel.updateStreamConfig(req.params.eventId, req.user?.id, {
      streamUrl,
      streamProvider,
    });
    if (event?.error) return res.status(400).json({ error: event.error });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function goLive(req, res, next) {
  try {
    const result = await streamModel.goLive(req.params.eventId, req.user?.id);
    if (result?.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function endLive(req, res, next) {
  try {
    const event = await streamModel.endLive(req.params.eventId, req.user?.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function getLiveStatus(req, res, next) {
  try {
    const status = await streamModel.getLiveStatus(req.params.id);
    if (!status) return res.status(404).json({ error: 'Event not found' });
    res.json(status);
  } catch (e) {
    next(e);
  }
}

export async function getStreamAccess(req, res, next) {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Access token is required' });
    const result = await streamModel.validateStreamAccess(req.params.id, token);
    if (result.error) {
      const code = result.notLive ? 403 : 401;
      return res.status(code).json(result);
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
}
