import { Router, type IRouter } from "express";
import healthRouter from "./health";
import floraRouter from "./flora";
import locationsRouter from "./locations";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(floraRouter);
router.use(locationsRouter);
router.use(storageRouter);

export default router;
