// Polymarket Routes Index
// Aggregates all Polymarket REST API routes

import { Router } from "express";
import eventsRouter from "./events";
import marketsRouter from "./markets";
import healthRouter from "./health";

const router = Router();

// Mount route modules
router.use("/events", eventsRouter);
router.use("/markets", marketsRouter);
router.use("/health", healthRouter);

export default router;
