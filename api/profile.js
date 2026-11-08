import app from '../server.js';

export default function handler(req, res) {
  const queryIndex = req.url?.indexOf('?') ?? -1;
  req.url = `/api/profile${queryIndex >= 0 ? req.url.slice(queryIndex) : ''}`;
  return app(req, res);
}
