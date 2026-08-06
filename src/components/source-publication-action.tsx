"use client";

import { useState } from "react";
import { z } from "zod";

const publicationResponseSchema = z.object({
  food: z.object({
    id: z.number().int().positive(),
    publishedAt: z.iso.datetime({ offset: true }),
    verificationMethod: z.literal("human"),
  }),
});
const errorResponseSchema = z.object({ error: z.string() });

type PublicationMessage = {
  readonly kind: "error" | "success";
  readonly text: string;
};

type SourcePublicationActionProps = {
  readonly busy: boolean;
  readonly foodId: number | null;
  readonly hasUnappliedCandidates: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onPublished: () => Promise<void>;
};

export function SourcePublicationAction({
  busy,
  foodId,
  hasUnappliedCandidates,
  onBusyChange,
  onPublished,
}: SourcePublicationActionProps) {
  const [message, setMessage] = useState<PublicationMessage | null>(null);

  async function publish() {
    if (foodId === null || hasUnappliedCandidates) return;
    onBusyChange(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/foods/${foodId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const parsedError = errorResponseSchema.safeParse(data);
        throw new Error(
          parsedError.success ? parsedError.data.error : "요청에 실패했습니다.",
        );
      }
      if (!publicationResponseSchema.safeParse(data).success) {
        throw new Error("발행 결과를 확인하지 못했습니다.");
      }

      await onPublished();
      setMessage({
        kind: "success",
        text: "근거 검증을 완료하고 카탈로그에 발행했습니다.",
      });
    } catch (error: unknown) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "네트워크 오류가 발생했습니다.",
      });
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <>
      <button
        className="primary"
        disabled={busy || foodId === null || hasUnappliedCandidates}
        onClick={publish}
      >
        검증 및 발행
      </button>
      {message && (
        <p
          className={message.kind === "success" ? "okbox" : "err"}
          role={message.kind === "success" ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
