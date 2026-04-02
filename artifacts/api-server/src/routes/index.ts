import { Router, type IRouter } from "express";
import healthRouter from "./health";
import callsRouter from "./calls";
import contactsRouter from "./contacts";
import tasksRouter from "./tasks";
import messagesRouter from "./messages";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(callsRouter);
router.use(contactsRouter);
router.use(tasksRouter);
router.use(messagesRouter);
router.use(dashboardRouter);

export default router;
