import { Router, type IRouter } from "express";
import healthRouter from "./health";
import floraRouter from "./flora";

const router: IRouter = Router();

router.use(healthRouter);
router.use(floraRouter);

export default router;
