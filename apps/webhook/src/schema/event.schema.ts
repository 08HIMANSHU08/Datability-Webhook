import { z } from "zod";
import { EVENT_TYPES } from "../webhook.interface";

export const EventSchema = z
  .object({
    eventId: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => value.trim().length > 0, "eventId must not be blank"),
    eventType: z.enum(EVENT_TYPES),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
