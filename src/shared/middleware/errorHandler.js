export function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    status === 500 && isProd ? 'Something went wrong. Please try again.' : (err.message || 'Internal Server Error');
  if (status === 500) {
    console.error('[api] 500 Error:', err.message);
    console.error(err.stack);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({ error: message });
}

