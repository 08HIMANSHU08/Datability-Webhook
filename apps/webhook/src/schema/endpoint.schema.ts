import { z } from "zod";
import { EVENT_TYPES } from "../webhook.interface";

export const EndpointSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            /^https?:\/\//i.test(value) &&
            value.trim() === value &&
            /^https?:$/.test(url.protocol) &&
            Boolean(url.hostname) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "url must be an absolute HTTP or HTTPS URL without credentials"),
    events: z
      .array(z.enum(EVENT_TYPES))
      .min(1)
      .max(100)
      .transform((events) => [...new Set(events)]),
  })
  .strict();
