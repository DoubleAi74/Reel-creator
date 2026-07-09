import { describe, expect, it } from "vitest";

import {
  FIRE_COST_MINOR,
  MICROS_PER_MINOR,
  TOP_UP_MAX_MINOR,
  TOP_UP_MIN_MINOR,
  canDebitMinor,
  clampMinor,
  debitMinor,
  formatGbpFromMinor,
  isValidTopUpMinor,
  minorToMajorUnit,
  parseGbpInputToMinor,
  roundMicrosToPenceHalfUp,
} from "./money.js";

describe("money helpers", () => {
  it("formats integer pence as GBP without floating-point maths", () => {
    expect(formatGbpFromMinor(0)).toBe("\u00a30.00");
    expect(formatGbpFromMinor(2)).toBe("\u00a30.02");
    expect(formatGbpFromMinor(500)).toBe("\u00a35.00");
    expect(formatGbpFromMinor(12345)).toBe("\u00a3123.45");
    expect(formatGbpFromMinor(-125)).toBe("-\u00a31.25");
  });

  it("debits the exact 2p fire cost when enough balance exists", () => {
    expect(FIRE_COST_MINOR).toBe(2);
    expect(debitMinor(500, FIRE_COST_MINOR)).toBe(498);
    expect(debitMinor(2, FIRE_COST_MINOR)).toBe(0);
  });

  it("refuses to debit below zero", () => {
    expect(canDebitMinor(1, FIRE_COST_MINOR)).toBe(false);
    expect(debitMinor(1, FIRE_COST_MINOR)).toBe(1);
    expect(debitMinor(0, FIRE_COST_MINOR)).toBe(0);
  });

  it("parses GBP input into integer pence", () => {
    expect(parseGbpInputToMinor("5")).toBe(500);
    expect(parseGbpInputToMinor("5.5")).toBe(550);
    expect(parseGbpInputToMinor("5.05")).toBe(505);
    expect(parseGbpInputToMinor("0.02")).toBe(2);
    expect(parseGbpInputToMinor("5.005")).toBe(null);
    expect(parseGbpInputToMinor("-1")).toBe(null);
  });

  it("clamps integer pence to a bounded range", () => {
    expect(clampMinor(-1, 0, 1000)).toBe(0);
    expect(clampMinor(500, 0, 1000)).toBe(500);
    expect(clampMinor(1500, 0, 1000)).toBe(1000);
  });

  it("converts minor units to major units only at payment boundaries", () => {
    expect(minorToMajorUnit(100)).toBe(1);
    expect(minorToMajorUnit(1234)).toBe(12.34);
    expect(() => minorToMajorUnit(-1)).toThrow("Invalid minor-unit amount.");
    expect(() => minorToMajorUnit(1.5)).toThrow("Invalid minor-unit amount.");
  });

  it("rounds micro-pence half-up to integer pence", () => {
    expect(MICROS_PER_MINOR).toBe(1_000_000);
    expect(roundMicrosToPenceHalfUp(0)).toBe(0);
    expect(roundMicrosToPenceHalfUp(499_999)).toBe(0);
    expect(roundMicrosToPenceHalfUp(500_000)).toBe(1);
    expect(roundMicrosToPenceHalfUp(1_500_000)).toBe(2);
    expect(() => roundMicrosToPenceHalfUp(-1)).toThrow("Invalid micro-pence");
  });

  it("validates custom top-ups as integer pence from 1p to \u00a3100", () => {
    expect(TOP_UP_MIN_MINOR).toBe(1);
    expect(TOP_UP_MAX_MINOR).toBe(10000);
    expect(isValidTopUpMinor(0)).toBe(false);
    expect(isValidTopUpMinor(1)).toBe(true);
    expect(isValidTopUpMinor(10000)).toBe(true);
    expect(isValidTopUpMinor(10001)).toBe(false);
    expect(isValidTopUpMinor(100.5)).toBe(false);
  });
});
