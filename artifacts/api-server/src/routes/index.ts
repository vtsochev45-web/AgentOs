import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import activityRouter from "./activity";
import vpsRouter from "./vps";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(activityRouter);
router.use(vpsRouter);
router.use(settingsRouter);

export default router;
