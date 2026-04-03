import { Router, type IRouter } from "express";
import healthRouter from "./health";
import callsRouter from "./calls";
import contactsRouter from "./contacts";
import tasksRouter from "./tasks";
import messagesRouter from "./messages";
import dashboardRouter from "./dashboard";
import aiAnalysisRouter from "./ai-analysis";
import workspaceRouter from "./workspace";
import integrationsRouter from "./integrations";
import checkinsRouter from "./checkins";
import aiAgentsRouter from "./ai-agents";
import stockRouter from "./stock";

const router: IRouter = Router();

router.use(healthRouter);
router.use(callsRouter);
router.use(contactsRouter);
router.use(tasksRouter);
router.use(messagesRouter);
router.use(dashboardRouter);
router.use(aiAnalysisRouter);
router.use(aiAgentsRouter);
router.use(stockRouter);
router.use("/workspace", workspaceRouter);
router.use("/integrations", integrationsRouter);
router.use(checkinsRouter);

export default router;
