import { env } from '../config/env.js';

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode ?? error.status ?? 500;

  const response = {
    status: 'error',
    message:
      statusCode === 500 ? 'Error interno del servidor' : error.message,
  };

  if (!env.isDevelopment) {
    return res.status(statusCode).json(response);
  }

  return res.status(statusCode).json({
    ...response,
    stack: error.stack,
  });
};
