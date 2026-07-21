import { z } from "zod";

/**
 * `YYYY-MM-DD` 달력 날짜. 형식뿐 아니라 실재하는 날짜인지도 확인한다
 * (`2026-02-31`은 정규식은 통과하지만 실재하지 않는다).
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate);

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
  );
}
