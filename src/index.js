import cors from 'cors';
import express from 'express';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFoundHandler } from './middlewares/not-found.middleware.js';

const app = express();

app.use(
  cors({
    origin: env.isDevelopment ? '*' : env.corsOrigin ?? '*',
  }),
);
app.use(express.json());

app.use('/api', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Hackemate API escuchando en el puerto ${env.port}`);
});

export { app };
