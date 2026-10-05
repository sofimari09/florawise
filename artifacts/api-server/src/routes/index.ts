import { Router, type IRouter } from "express";
import healthRouter from "./health";
import floraRouter from "./flora";
import locationsRouter from "./locations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(floraRouter);
router.use(locationsRouter);

export default router;
