import { Router } from 'express';
import syncRouter from './sync.js';
import tradesRouter from './trades.js';
import algoRouter from './algo.js';
import usersRouter from './users.js';
import playersRouter from './players.js';
import draftRouter from './draft.js';
import analyticsRouter from './analytics.js';

// Combined admin router. Each sub-router attaches routes whose paths already
// carry the appropriate prefix (e.g. `/sync/preview`, `/trades/values`), so
// they are mounted at the root and preserve the existing URL surface under
// the parent `/api/admin` mount.
const router = Router();

router.use(syncRouter);
router.use(tradesRouter);
router.use(algoRouter);
router.use(usersRouter);
router.use(playersRouter);
router.use(draftRouter);
router.use(analyticsRouter);

export default router;
