import mongoose from "mongoose";

const nonNegativeIntegerValidator = {
  validator(value) {
    return Number.isInteger(value) && value >= 0;
  },
  message: "Generation counter values must be non-negative integers.",
};

const generationCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
      validate: nonNegativeIntegerValidator,
    },
  },
  {
    versionKey: false,
  },
);

export const GenerationCounter =
  mongoose.models.GenerationCounter ??
  mongoose.model(
    "GenerationCounter",
    generationCounterSchema,
    "generation_counters",
  );
