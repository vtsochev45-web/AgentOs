import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import activityRouter from "./activity";
import vpsRouter from "./vps";
import settingsRouter from "./settings";
import skillsRouter from "./skills";
import openclawRouter from "./openclaw";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(activityRouter);
router.use(vpsRouter);
router.use(settingsRouter);
router.use(skillsRouter);
router.use(openclawRouter);

export default router;
