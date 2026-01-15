import express from "express";

export const userStreams = new Map<string, Set<express.Response>>();
