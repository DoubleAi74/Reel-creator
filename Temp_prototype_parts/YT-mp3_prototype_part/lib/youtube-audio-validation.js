import { z } from "zod";
import {
  DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID,
  YOUTUBE_AUDIO_PROVIDER_IDS,
} from "./provider-options.js";
import { extractYouTubeVideoId } from "./youtube-url.js";

export const MIN_SEGMENT_SECONDS = 1;
export const MAX_SEGMENT_SECONDS = 6 * 60;

export const youtubeAudioSegmentSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => Boolean(extractYouTubeVideoId(value)), {
        message: "Enter a valid YouTube link",
      }),
    startTime: z.number().finite().min(0),
    endTime: z.number().finite().positive(),
    providerId: z
      .enum(YOUTUBE_AUDIO_PROVIDER_IDS)
      .default(DEFAULT_YOUTUBE_AUDIO_PROVIDER_ID),
  })
  .superRefine((value, context) => {
    if (value.endTime <= value.startTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "endTime must be greater than startTime",
      });
    }

    const duration = value.endTime - value.startTime;

    if (duration < MIN_SEGMENT_SECONDS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Requested segment is shorter than 1 second",
      });
    }

    if (duration > MAX_SEGMENT_SECONDS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTime"],
        message: "Requested segment exceeds the 6-minute application limit",
      });
    }
  });

export function parseYoutubeAudioSegmentRequest(value) {
  return youtubeAudioSegmentSchema.safeParse(value);
}
