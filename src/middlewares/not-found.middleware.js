export const notFoundHandler = (req, _res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;

  return next(error);
};
