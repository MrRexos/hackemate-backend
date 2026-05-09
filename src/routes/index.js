import { Router } from 'express';

import healthRoutes from './health.routes.js';
import logisticsRoutes from './logistics.routes.js';
import userRoutes from './user.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/logistics', logisticsRoutes);
router.use('/users', userRoutes);

export default router;
